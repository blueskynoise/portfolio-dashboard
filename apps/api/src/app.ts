import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AdminAssessmentRow, AssessmentReport, AssessmentRequest, AssessmentResponse, FingerprintReport, GateConfig, PublicHealth } from '@portfolio/contracts';
import { POLICY_DOCUMENT, POLICY_VERSION, THRESHOLDS } from '@portfolio/policy';
import { verifyPassword } from './admin/auth';
import { computeOverview, publicHealth } from './admin/metrics';
import { runAssessment, type Providers } from './assess';
import { hmacIp, isPublicIp, resolveClientIp } from './clientIp';
import type { Config } from './config';
import { correlate } from './correlation';
import type { RequestEvidence } from './evidence';
import { buildFingerprintSignals, findInconsistencies, sanitizeSubmission } from './fingerprint';
import { SlidingCounter } from './rateLimit';
import { hashOpaque, hashUserAgent, issueToken, newId, verifyToken } from './sessions';
import { contentType, type StaticSite } from './static';
import type { EventType, Store } from './store/types';
import { parseUserAgent } from './ua';

export interface AppDeps {
  config: Config;
  store: Store;
  providers: Providers;
  site: StaticSite | null;
  now?: () => number;
  logger?: boolean;
}

const MINUTE = 60_000;
const API_REQUESTS_PER_MINUTE = 240;
const ADMIN_LOGIN_ATTEMPTS = 5;
const ADMIN_SESSION_MINUTES = 60;
const BROWSER_COOKIE_DAYS = 90;

type SessionCheck =
  | { ok: true; sessionId: string; assessmentId: string; expiresAt: Date }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'unknown' | 'revoked' | 'client_changed' };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, providers, site } = deps;
  const now = deps.now ?? Date.now;
  const production = config.env === 'production';
  // The __Host- prefix makes the browser refuse the cookie unless it is Secure, host-only and Path=/.
  const prefix = production ? '__Host-' : '';
  const COOKIE = { session: `${prefix}pd_session`, browser: `${prefix}pd_browser`, admin: `${prefix}pd_admin` };
  const cookieBase = { path: '/', httpOnly: true, secure: production, sameSite: 'lax' as const };

  const counters = {
    api: new SlidingCounter(MINUTE, now),
    assessments: new SlidingCounter(THRESHOLDS.rateWindowMinutes * MINUTE, now),
    challengeFailures: new SlidingCounter(THRESHOLDS.rateWindowMinutes * MINUTE, now),
    adminLogins: new SlidingCounter(15 * MINUTE, now),
  };
  const pruner = setInterval(() => Object.values(counters).forEach((counter) => counter.prune()), 5 * MINUTE);
  pruner.unref();

  const app: FastifyInstance = Fastify({
    bodyLimit: 32 * 1024,
    // We decide for ourselves which forwarding header to believe; see clientIp.ts.
    trustProxy: false,
    genReqId: (req) => {
      const upstream = req.headers['x-railway-request-id'];
      return typeof upstream === 'string' && /^[\w-]{8,64}$/.test(upstream) ? upstream : randomUUID();
    },
    logger: deps.logger === false
      ? false
      : {
          level: config.env === 'test' ? 'silent' : 'info',
          // Logs never carry addresses, cookies or query strings.
          redact: ['req.headers.cookie', 'req.headers.authorization'],
          serializers: {
            req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
            res: (res: { statusCode: number }) => ({ status: res.statusCode }),
          },
        },
  });
  app.addHook('onClose', async () => clearInterval(pruner));
  await app.register(cookie);

  // ── Request helpers ─────────────────────────────────────────────────
  const header = (req: FastifyRequest, name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const clientIp = (req: FastifyRequest) => resolveClientIp(config.clientIpSource, config.forwardedHops, { socketAddress: req.socket.remoteAddress, header: (name) => header(req, name) });
  const ipKeyOf = (req: FastifyRequest): string | null => {
    const { ip } = clientIp(req);
    return ip ? hmacIp(ip, config.ipHashSecret) : null;
  };
  const isTls = (req: FastifyRequest): boolean =>
    config.clientIpSource === 'socket' ? Boolean((req.socket as { encrypted?: boolean }).encrypted) : header(req, 'x-forwarded-proto') === 'https';
  const requestEvidence = (req: FastifyRequest): RequestEvidence => {
    const ip = clientIp(req);
    return {
      ip,
      publicIp: ip.ip ? isPublicIp(ip.ip) : false,
      tls: isTls(req),
      userAgent: header(req, 'user-agent')?.slice(0, 400),
      acceptLanguage: header(req, 'accept-language')?.slice(0, 200),
      clientHintBrands: header(req, 'sec-ch-ua')?.slice(0, 200),
      clientHintPlatform: header(req, 'sec-ch-ua-platform')?.slice(0, 40),
      clientHintMobile: header(req, 'sec-ch-ua-mobile'),
      doNotTrack: header(req, 'dnt'),
      globalPrivacyControl: header(req, 'sec-gpc'),
    };
  };
  const event = (req: FastifyRequest, type: EventType, detail: string | null = null): void => {
    void store.recordEvent({ createdAt: new Date(now()), type, requestId: req.id, ipHmac: ipKeyOf(req), detail }).catch(() => undefined);
  };

  // Session validity is checked on every protected request. A short cache keeps asset loads off the database.
  const sessionCache = new Map<string, { at: number; uaHash: string; expiresAt: Date; assessmentId: string }>();
  async function checkSession(req: FastifyRequest): Promise<SessionCheck> {
    const token = verifyToken(req.cookies[COOKIE.session], config.sessionSecret, now());
    if (!token.ok) return { ok: false, reason: token.reason };
    const { sid } = token.payload;
    let cached = sessionCache.get(sid);
    if (!cached || now() - cached.at > 15_000) {
      const row = await store.getSession(sid);
      if (!row) return { ok: false, reason: 'unknown' };
      if (row.revokedAt) {
        sessionCache.delete(sid);
        return { ok: false, reason: 'revoked' };
      }
      if (row.expiresAt.getTime() <= now()) return { ok: false, reason: 'expired' };
      cached = { at: now(), uaHash: row.uaHash, expiresAt: row.expiresAt, assessmentId: row.assessmentId };
      if (sessionCache.size > 5000) sessionCache.clear();
      sessionCache.set(sid, cached);
    }
    // A cookie replayed from a different client does not match the browser it was issued to.
    if (cached.uaHash !== hashUserAgent(header(req, 'user-agent'))) return { ok: false, reason: 'client_changed' };
    return { ok: true, sessionId: sid, assessmentId: cached.assessmentId, expiresAt: cached.expiresAt };
  }
  const isAdmin = (req: FastifyRequest): boolean => {
    const token = verifyToken(req.cookies[COOKIE.admin], config.sessionSecret, now());
    return token.ok && token.payload.sid === 'admin';
  };

  // ── Cross-cutting hooks ─────────────────────────────────────────────
  const CSP_BASE = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  const CSP_APP = `${CSP_BASE}; script-src 'self'`;
  // The gate alone may load the bot-verification widget.
  const CSP_GATE = `${CSP_BASE}; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com`;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    reply.header('content-security-policy', CSP_APP);
    if (production) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');

    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
      const key = ipKeyOf(req) ?? 'unknown';
      if (counters.api.hit(key) > API_REQUESTS_PER_MINUTE) {
        event(req, 'rate_limited', 'api');
        return reply.code(429).header('retry-after', counters.api.retryAfterSeconds(key)).send({ error: 'rate_limited' });
      }
      // Browsers attach Origin to every state-changing request. If it is there, it has to be ours.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = header(req, 'origin');
        const expected = config.publicOrigin ?? `${isTls(req) ? 'https' : 'http'}://${header(req, 'host') ?? ''}`;
        if (origin !== undefined && origin !== expected) {
          event(req, 'origin_rejected', null);
          return reply.code(403).send({ error: 'origin_not_allowed' });
        }
      }
    }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    const status = error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) req.log.error({ err: error.message }, 'unhandled error');
    // The client gets a correlation id, never the error.
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : 'bad_request', requestId: req.id });
  });

  // ── Health ──────────────────────────────────────────────────────────
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await store.ping();
    } catch {
      return reply.code(503).send({ status: 'unavailable', store: 'unreachable' });
    }
    return {
      status: 'ok',
      store: store.kind,
      policyVersion: POLICY_VERSION,
      providers: {
        turnstile: providers.turnstile.configured ? 'configured' : 'unconfigured',
        'ipapi.is': providers.ipapi.configured ? 'configured' : 'unconfigured',
        ipinfo: providers.ipinfo.configured ? 'configured' : 'unconfigured',
        abuseipdb: providers.abuse.configured ? 'configured' : 'unconfigured',
        torproject: providers.tor.size > 0 ? `${providers.tor.size} exits loaded` : 'not loaded',
      },
    };
  });

  // ── Public API ──────────────────────────────────────────────────────
  app.get('/api/gate/config', async (): Promise<GateConfig> => ({
    environment: config.env,
    policyVersion: POLICY_VERSION,
    sessionTtlMinutes: config.sessionTtlMinutes,
    retentionDays: config.retentionDays,
    botVerification: { provider: 'turnstile', configured: providers.turnstile.configured, siteKey: providers.turnstile.siteKey },
    providers: [
      { name: 'ipapi.is', purpose: 'Organization, network type, coarse location, VPN/proxy flags', configured: providers.ipapi.configured, note: 'Your IP address is sent to this provider.' },
      { name: 'IPinfo', purpose: 'Network operator and country (second opinion)', configured: providers.ipinfo.configured, note: 'Your IP address is sent to this provider.' },
      { name: 'Tor Project', purpose: 'Tor exit relay list', configured: true, note: 'A public list we download. Your address is not sent anywhere.' },
      { name: 'AbuseIPDB', purpose: 'Abuse reports about the address', configured: providers.abuse.configured, note: 'Your IP address is sent to this provider.' },
      { name: 'Cloudflare Turnstile', purpose: 'Bot verification', configured: providers.turnstile.configured, note: 'Runs a script from Cloudflare in the page; your IP address is included in the verification request.' },
    ],
  }));

  app.get('/api/policy', async () => POLICY_DOCUMENT);

  // Aggregate-only gateway health. Public, cached for a minute, and silent about outcomes until there is enough
  // traffic that a figure cannot describe an individual.
  let healthCache: { at: number; value: PublicHealth } | null = null;
  app.get('/api/gateway/health', async (): Promise<PublicHealth> => {
    if (healthCache && now() - healthCache.at < 60_000) return healthCache.value;
    const windowDays = 7;
    const since = new Date(now() - windowDays * 86_400_000);
    const [assessments, calls] = await Promise.all([store.listAssessmentsSince(since), store.listProviderCallsSince(since)]);
    const overview = computeOverview({ assessments, calls, events: [], investigations: [], fingerprints: [], now: new Date(now()), windowDays });
    const value = publicHealth(overview, POLICY_VERSION, {
      turnstile: providers.turnstile.configured,
      'ipapi.is': providers.ipapi.configured,
      ipinfo: providers.ipinfo.configured,
      abuseipdb: providers.abuse.configured,
      torproject: true,
    });
    healthCache = { at: now(), value };
    return value;
  });

  app.post('/api/assessments', async (req, reply): Promise<AssessmentResponse | FastifyReply> => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as AssessmentRequest;
    const existing = req.cookies[COOKIE.session] ? await checkSession(req) : null;
    const continuity = existing === null ? 'new' : existing.ok ? 'reassessment_of_active_session' : 'expired_or_invalid_session_presented';

    const result = await runAssessment(
      { providers, counters, ipHashSecret: config.ipHashSecret, now },
      { requestId: req.id, request: requestEvidence(req), body: { client: sanitizeClient(body.client), botToken: typeof body.botToken === 'string' ? body.botToken : undefined }, continuity },
    );
    if (result.record.botStatus === 'failed') event(req, 'challenge_failed', result.record.reasonCodes.join(','));

    try {
      // No decision takes effect until it is on record.
      await store.saveAssessment(result.record, result.calls);
    } catch (error) {
      req.log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'could not record assessment');
      event(req, 'assessment_error', 'store');
      return reply.code(503).header('retry-after', 5).send({ error: 'assessment_unavailable', requestId: req.id });
    }

    const admitted = result.live.decision === 'ALLOW';
    if (admitted) {
      const expiresAt = new Date(now() + config.sessionTtlMinutes * MINUTE);
      const sessionId = newId();
      await store.createSession({ id: sessionId, assessmentId: result.record.id, createdAt: new Date(now()), expiresAt, revokedAt: null, uaHash: hashUserAgent(header(req, 'user-agent')) });
      if (existing?.ok) {
        await store.revokeSession(existing.sessionId, new Date(now()));
        sessionCache.delete(existing.sessionId);
      }
      reply.setCookie(COOKIE.session, issueToken({ sid: sessionId, aid: result.record.id, exp: Math.floor(expiresAt.getTime() / 1000) }, config.sessionSecret), { ...cookieBase, expires: expiresAt });
      result.live.session = { expiresAt: expiresAt.toISOString() };
    }
    req.log.info(
      { evt: 'assessment', id: result.record.id, decision: result.record.decision, assurance: result.record.assurance, reasons: result.record.reasonCodes, ms: result.record.totalMs, providers: Object.fromEntries(result.calls.map((c) => [c.provider, c.status])) },
      'assessment complete',
    );
    return reply.code(admitted ? 201 : result.live.decision === 'DENY' ? 403 : 200).send({ report: result.live, admitted });
  });

  // ── Visitor API (session required) ──────────────────────────────────
  const requireSession = async (req: FastifyRequest, reply: FastifyReply): Promise<Extract<SessionCheck, { ok: true }> | null> => {
    const session = await checkSession(req);
    if (session.ok) return session;
    if (session.reason !== 'missing') event(req, 'session_rejected', session.reason);
    void reply.code(401).send({ error: 'session_required', reason: session.reason });
    return null;
  };

  /** A visitor only ever gets the report their own session points at. There is no id in the URL to tamper with. */
  async function ownReport(req: FastifyRequest, assessmentId: string): Promise<AssessmentReport | null> {
    const record = await store.getAssessment(assessmentId);
    if (!record) return null;
    const report = structuredClone(record.report);
    // Put back the values we deliberately did not store, but only for the connection they belong to.
    const { ip } = clientIp(req);
    for (const s of report.signals) {
      if (s.key === 'network.ip' && ip && hmacIp(ip, config.ipHashSecret) === record.ipHmac) s.value = ip;
      if (s.key === 'browser.user_agent') s.value = header(req, 'user-agent') ?? s.value;
    }
    const fingerprint = await store.getFingerprint(assessmentId);
    if (fingerprint) report.fingerprint = fingerprint.report;
    return report;
  }

  app.get('/api/session', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return reply;
    return { assessmentId: session.assessmentId, expiresAt: session.expiresAt.toISOString(), admin: isAdmin(req) };
  });

  app.post('/api/session/end', async (req, reply) => {
    const session = await checkSession(req);
    if (session.ok) {
      await store.revokeSession(session.sessionId, new Date(now()));
      sessionCache.delete(session.sessionId);
    }
    reply.clearCookie(COOKIE.session, cookieBase);
    return { ended: true };
  });

  app.get('/api/me/assessment', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return reply;
    const report = await ownReport(req, session.assessmentId);
    if (!report) return reply.code(404).send({ error: 'not_found' });
    report.session = { expiresAt: session.expiresAt.toISOString() };
    return report;
  });

  app.post('/api/me/fingerprint', async (req, reply): Promise<FingerprintReport | FastifyReply> => {
    const session = await requireSession(req, reply);
    if (!session) return reply;
    const body = (req.body ?? {}) as { consent?: unknown; fingerprint?: unknown };
    // Fingerprinting is opt-in. Without an explicit yes, nothing is processed or stored.
    if (body.consent !== true) return reply.code(400).send({ error: 'consent_required' });
    const submission = sanitizeSubmission(body.fingerprint);
    if (!submission) return reply.code(400).send({ error: 'invalid_fingerprint' });

    const previous = await store.getFingerprint(session.assessmentId);
    if (previous) return previous.report;
    const record = await store.getAssessment(session.assessmentId);
    if (!record) return reply.code(404).send({ error: 'not_found' });

    const request = requestEvidence(req);
    const ua = parseUserAgent(request.userAgent);
    const keyed = (value: string | undefined): string | null => (value ? hashOpaque(value, config.ipHashSecret) : null);
    const presentedCookie = req.cookies[COOKIE.browser];
    const cookieId = presentedCookie && /^[\w-]{20,40}$/.test(presentedCookie) ? presentedCookie : null;
    const createdAt = new Date(now());
    const current = {
      cookieHash: keyed(cookieId ?? undefined),
      libraryHash: keyed(submission.libraryHash) as string,
      canvasHash: keyed(submission.canvasHash),
      webglHash: keyed(submission.webglHash),
      audioHash: keyed(submission.audioHash),
      asn: record.asn,
      ipPrefix: record.ipPrefix,
      browserFamily: ua.family,
      osFamily: ua.os,
    };
    const prior = await store.findRelatedFingerprints({ cookieHash: current.cookieHash, libraryHash: current.libraryHash, canvasHash: current.canvasHash }, createdAt);
    const recognition = correlate(current, prior);
    const onFile = await store.countDistinctFingerprints();
    // Normally a cache hit from the assessment a moment ago. If not, it is one budgeted call.
    const ipTimezone = request.ip.ip && request.publicIp ? ((await providers.ipapi.lookup(request.ip.ip)).data?.timezone ?? null) : null;
    const report: FingerprintReport = {
      collectedAt: createdAt.toISOString(),
      signals: buildFingerprintSignals(submission, onFile + (prior.some((p) => p.libraryHash === current.libraryHash) ? 0 : 1)),
      inconsistencies: findInconsistencies(submission, request, ua, ipTimezone),
      recognition,
      fingerprintsOnFile: onFile,
    };

    // Set the recognition cookie only now, after consent, and only if this browser does not already carry one.
    const newCookieId = cookieId ?? newId();
    await store.saveFingerprint({ assessmentId: record.id, createdAt, ...current, cookieHash: keyed(newCookieId), recognition: recognition.status, report });
    if (!cookieId) reply.setCookie(COOKIE.browser, newCookieId, { ...cookieBase, maxAge: BROWSER_COOKIE_DAYS * 86_400 });
    return reply.code(201).send(report);
  });

  /** Withdrawing consent: delete the stored fingerprint and the recognition cookie. */
  app.delete('/api/me/fingerprint', async (req, reply) => {
    const session = await requireSession(req, reply);
    if (!session) return reply;
    await store.deleteFingerprint(session.assessmentId);
    reply.clearCookie(COOKIE.browser, cookieBase);
    return { deleted: true };
  });

  // ── Admin API ───────────────────────────────────────────────────────
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!config.adminPasswordHash) {
      void reply.code(404).send({ error: 'admin_unconfigured' });
      return false;
    }
    if (!isAdmin(req)) {
      void reply.code(401).send({ error: 'admin_required' });
      return false;
    }
    return true;
  };

  app.post('/api/admin/login', async (req, reply) => {
    if (!config.adminPasswordHash) return reply.code(404).send({ error: 'admin_unconfigured' });
    const key = ipKeyOf(req) ?? 'unknown';
    if (counters.adminLogins.count(key) >= ADMIN_LOGIN_ATTEMPTS) {
      event(req, 'rate_limited', 'admin_login');
      return reply.code(429).header('retry-after', counters.adminLogins.retryAfterSeconds(key)).send({ error: 'too_many_attempts' });
    }
    const password = (req.body as { password?: unknown } | null)?.password;
    if (typeof password !== 'string' || !verifyPassword(password, config.adminPasswordHash)) {
      counters.adminLogins.hit(key);
      event(req, 'admin_login_failed');
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    event(req, 'admin_login');
    const exp = Math.floor(now() / 1000) + ADMIN_SESSION_MINUTES * 60;
    reply.setCookie(COOKIE.admin, issueToken({ sid: 'admin', aid: 'admin', exp }, config.sessionSecret), { ...cookieBase, sameSite: 'strict', maxAge: ADMIN_SESSION_MINUTES * 60 });
    return { ok: true };
  });

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE.admin, { ...cookieBase, sameSite: 'strict' });
    return { ok: true };
  });

  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    const requested = Number((req.query as { days?: string }).days);
    const windowDays = [1, 7, 30].includes(requested) ? requested : 7;
    const since = new Date(now() - windowDays * 86_400_000);
    const [assessments, calls, events, investigations, fingerprints] = await Promise.all([
      store.listAssessmentsSince(since),
      store.listProviderCallsSince(since),
      store.listEventsSince(since),
      store.listInvestigations(),
      store.listFingerprintsSince(since),
    ]);
    return computeOverview({ assessments, calls, events, investigations, fingerprints, now: new Date(now()), windowDays });
  });

  app.get('/api/admin/assessments', async (req, reply): Promise<AdminAssessmentRow[] | FastifyReply> => {
    if (!requireAdmin(req, reply)) return reply;
    const since = new Date(now() - 30 * 86_400_000);
    const [assessments, investigations] = await Promise.all([store.listAssessmentsSince(since), store.listInvestigations()]);
    const flagged = new Map(investigations.map((i) => [i.assessmentId, i]));
    return assessments.slice(-100).reverse().map((a) => {
      const investigation = flagged.get(a.id);
      return {
        id: a.id,
        createdAt: a.createdAt.toISOString(),
        decision: a.decision,
        assurance: a.assurance,
        policyVersion: a.policyVersion,
        reasonCodes: a.reasonCodes,
        network: a.asn ? `${a.asn}${a.asOrg ? ` ${a.asOrg}` : ''}` : (a.ipPrefix ?? 'unknown'),
        organization: a.orgName && a.orgType !== 'isp' && a.orgType !== 'hosting' ? a.orgName : null,
        country: a.country,
        browser: `${a.browserFamily}${a.browserMajor ? ` ${a.browserMajor}` : ''} / ${a.osFamily}`,
        botStatus: a.botStatus,
        totalMs: a.totalMs,
        investigation: investigation ? { status: investigation.status, note: investigation.note } : null,
      };
    });
  });

  app.post('/api/admin/assessments/:id/investigation', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: unknown; note?: unknown };
    if ((body.status !== 'open' && body.status !== 'closed') || typeof body.note !== 'string') return reply.code(400).send({ error: 'invalid_investigation' });
    if (!(await store.getAssessment(id))) return reply.code(404).send({ error: 'not_found' });
    const at = new Date(now());
    await store.upsertInvestigation({ assessmentId: id, status: body.status, note: body.note.slice(0, 500), createdAt: at, updatedAt: at });
    return { ok: true };
  });

  app.all('/api/*', async (_req, reply) => reply.code(404).send({ error: 'not_found' }));

  // ── The web app, with the gate enforced here ───────────────────────
  if (site) {
    app.get('/*', async (req, reply) => {
      const path = req.url.split('?')[0] ?? '/';
      const file = site.files.get(path);
      if (file) {
        if (!site.publicPaths.has(path) && !(await checkSession(req)).ok) {
          return reply.code(401).header('cache-control', 'no-store').send({ error: 'session_required' });
        }
        reply.header('content-type', contentType(path));
        // Hashed build output never changes; protected files stay out of shared caches.
        reply.header('cache-control', path.startsWith('/static/') ? (site.publicPaths.has(path) ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable') : 'private, max-age=3600');
        return reply.send(createReadStream(file));
      }
      // Anything else is a page navigation. Which document comes back depends on the session, decided here.
      const session = await checkSession(req);
      if (!session.ok && session.reason !== 'missing') {
        event(req, 'session_rejected', session.reason);
        reply.clearCookie(COOKIE.session, cookieBase);
      }
      reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('vary', 'cookie');
      reply.header('content-security-policy', session.ok ? CSP_APP : CSP_GATE);
      return reply.send(session.ok ? site.appHtml : site.gateHtml);
    });
  }

  return app;
}

/** Client evidence is untrusted input: keep only the fields we know, with bounded sizes. */
function sanitizeClient(raw: unknown): AssessmentRequest['client'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
  const uaData = input.uaData && typeof input.uaData === 'object' ? (input.uaData as Record<string, unknown>) : undefined;
  const caps = input.capabilities && typeof input.capabilities === 'object' ? (input.capabilities as Record<string, unknown>) : undefined;
  return {
    userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 400) : undefined,
    secureContext: flag(input.secureContext),
    cookiesEnabled: flag(input.cookiesEnabled),
    webdriver: flag(input.webdriver),
    languages: Array.isArray(input.languages) ? input.languages.filter((l): l is string => typeof l === 'string').slice(0, 12).map((l) => l.slice(0, 20)) : undefined,
    uaData: uaData
      ? {
          platform: typeof uaData.platform === 'string' ? uaData.platform.slice(0, 40) : undefined,
          mobile: flag(uaData.mobile),
          brands: Array.isArray(uaData.brands) ? uaData.brands.filter((b): b is string => typeof b === 'string').slice(0, 8).map((b) => b.slice(0, 40)) : undefined,
        }
      : undefined,
    capabilities: caps ? { webCrypto: flag(caps.webCrypto), webAuthn: flag(caps.webAuthn), serviceWorker: flag(caps.serviceWorker) } : undefined,
  };
}
