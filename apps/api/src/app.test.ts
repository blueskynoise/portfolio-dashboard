import { afterEach, describe, expect, it } from 'vitest';
import type { AssessmentReport, FingerprintReport, Signal } from '@portfolio/contracts';
import { POLICY_VERSION, THRESHOLDS } from '@portfolio/policy';
import { runRetention } from './retention';
import { ADMIN_PASSWORD, assess, CHROME_UA, harness, ipapiBody, json, requestHeaders, VISITOR_IP, type Harness } from './testing';

let h: Harness;
afterEach(async () => {
  await h?.app.close();
});

const signalOf = (report: AssessmentReport, key: string): Signal => {
  const found = report.signals.find((s) => s.key === key);
  if (!found) throw new Error(`no signal ${key}`);
  return found;
};
const reasons = (report: AssessmentReport): string[] => report.reasons.map((r) => r.code);
const get = (url: string, cookies?: Record<string, string>, extra: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers: requestHeaders({ cookies, headers: extra }) });
const FINGERPRINT = { libraryHash: 'thumbmark-hash-0001', canvasHash: 'canvas-0001', webglHash: 'webgl-0001', audioHash: 'audio-0001', timezone: 'America/New_York', languages: ['en-US'], platform: 'Win32', webglRenderer: 'ANGLE (Example GPU)' };
const submitFingerprint = (cookies: Record<string, string>, payload: object = { consent: true, fingerprint: FINGERPRINT }, visit: { ip?: string; ua?: string } = {}) =>
  h.app.inject({ method: 'POST', url: '/api/me/fingerprint', headers: requestHeaders({ cookies, ...visit }), payload });

describe('a successful assessment', () => {
  it('allows an ordinary visitor, explains itself, and issues a hardened session cookie', async () => {
    h = await harness();
    const { response, body, sessionCookie } = await assess(h);
    const report = body.report as AssessmentReport;

    expect(response.statusCode).toBe(201);
    expect(body.admitted).toBe(true);
    expect(report).toMatchObject({ decision: 'ALLOW', assurance: 'standard', policyVersion: POLICY_VERSION });
    expect(reasons(report)).toEqual(['BASELINE_SATISFIED']);
    expect(report.stages.map((s) => s.stage)).toEqual(['session', 'network', 'automation', 'browser', 'policy']);
    expect(report.providers.map((p) => [p.provider, p.status])).toEqual([['ipapi.is', 'ok'], ['ipinfo', 'ok'], ['torproject', 'cache'], ['abuseipdb', 'ok'], ['turnstile', 'ok']]);
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    expect(signalOf(report, 'network.ip')).toMatchObject({ value: VISITOR_IP, method: 'connection', kind: 'fact' });
    expect(signalOf(report, 'network.asn')).toMatchObject({ value: 'AS64500 · Example Broadband', method: 'enrichment', reliability: 'high' });
    expect(signalOf(report, 'network.organization')).toMatchObject({ kind: 'inference', reliability: 'low' });
    expect(signalOf(report, 'browser.identity').value).toBe('Chrome 140 on Windows');
    // What a public website cannot know is stated, not omitted.
    expect(signalOf(report, 'device.posture')).toMatchObject({ status: 'not_measurable', value: null });
    expect(signalOf(report, 'identity.person')).toMatchObject({ status: 'not_measurable' });
  });

  it('stores a truncated address and no full User-Agent', async () => {
    h = await harness();
    const { body } = await assess(h);
    const stored = [...h.store.assessments.values()][0];
    expect(stored?.ipPrefix).toBe('203.0.113.0/24');
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(VISITOR_IP);
    expect(serialized).not.toContain(CHROME_UA);
    expect(stored?.policyVersion).toBe(POLICY_VERSION);
    expect(stored?.id).toBe(body.report.id);
  });

  it('believes the platform edge about the address, not the client', async () => {
    h = await harness();
    await assess(h, { headers: { 'x-forwarded-for': '6.6.6.6', forwarded: 'for=6.6.6.6' } });
    expect(h.world.calls.find((url) => url.includes('ipinfo'))).toContain(VISITOR_IP);
    expect(h.world.calls.join(' ')).not.toContain('6.6.6.6');
  });
});

describe('missing and failing evidence', () => {
  it('with nothing configured, allows with reduced assurance and reports every gap as unknown', async () => {
    h = await harness({ configured: { ipapi: false, ipinfo: false, abuse: false, turnstile: false } });
    const { body } = await assess(h);
    const report = body.report as AssessmentReport;
    expect(report).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
    expect(reasons(report)).toEqual(expect.arrayContaining(['BOT_VERIFICATION_NOT_PERFORMED', 'NETWORK_CONTEXT_UNAVAILABLE']));
    expect(reasons(report)).not.toContain('BASELINE_SATISFIED');
    expect(signalOf(report, 'network.asn')).toMatchObject({ status: 'unconfigured', value: null, kind: 'gap' });
    expect(signalOf(report, 'automation.bot_verification')).toMatchObject({ status: 'unconfigured', value: 'unconfigured' });
    expect(signalOf(report, 'network.hosting').note).toMatch(/Unknown/);
    // No provider was called: there are no credentials to call with, and nothing was invented instead.
    expect(h.world.calls).toEqual([]);
  });

  it('survives a provider error without presenting it as a clean result', async () => {
    h = await harness({ configured: { ipinfo: false } });
    h.world.ipapi = () => json({ error: 'boom' }, 500);
    const { body } = await assess(h);
    const report = body.report as AssessmentReport;
    expect(report.providers.find((p) => p.provider === 'ipapi.is')?.status).toBe('error');
    expect(report).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
    expect(signalOf(report, 'network.anonymizer')).toMatchObject({ status: 'error', value: null });
    expect(report.rules.find((r) => r.code === 'HOSTING_NETWORK_UNVERIFIED')?.outcome).toBe('not_evaluable');
  });

  it('bounds a hanging provider by its timeout and records the timeout', async () => {
    h = await harness();
    h.world.ipapi = () => new Promise(() => undefined);
    h.world.abuse = () => new Promise(() => undefined);
    const started = Date.now();
    const { body } = await assess(h);
    expect(Date.now() - started).toBeLessThan(1000);
    const report = body.report as AssessmentReport;
    expect(report.providers.filter((p) => p.status === 'timeout').map((p) => p.provider)).toEqual(['ipapi.is', 'abuseipdb']);
    // The second-opinion provider still answered, so network context exists and the visitor is not stranded.
    expect(report.decision).toBe('ALLOW');
    expect(report.stages.find((s) => s.stage === 'network')?.status).toBe('failed');
  });

  it('treats an unreadable reputation answer as unknown, not as zero', async () => {
    h = await harness();
    h.world.abuse = () => json({ data: { somethingElse: true } });
    const { body } = await assess(h);
    const report = body.report as AssessmentReport;
    expect(signalOf(report, 'network.abuse_confidence')).toMatchObject({ value: null, status: 'error' });
    expect(report.rules.find((r) => r.code === 'ABUSE_REPUTATION_UNVERIFIED')?.outcome).toBe('not_evaluable');
  });

  it('fails open with reduced assurance when the bot provider is down', async () => {
    h = await harness();
    h.world.turnstile = () => json({}, 503);
    h.world.ipapi = () => json(ipapiBody({ is_datacenter: true, datacenter: { datacenter: 'ExampleHost' } }));
    const { body, sessionCookie } = await assess(h);
    const report = body.report as AssessmentReport;
    expect(report).toMatchObject({ decision: 'ALLOW', assurance: 'reduced' });
    expect(reasons(report)).toEqual(expect.arrayContaining(['CHALLENGE_UNAVAILABLE_FAIL_OPEN', 'BOT_VERIFICATION_PROVIDER_ERROR']));
    expect(sessionCookie).toBeDefined();
  });

  it('issues nothing if the decision cannot be recorded', async () => {
    h = await harness();
    h.store.failWrites = true;
    const { response, sessionCookie } = await assess(h);
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('assessment_unavailable');
    expect(sessionCookie).toBeUndefined();
  });

  it('does not penalize a verified visitor on a VPN in a datacenter', async () => {
    h = await harness();
    h.world.ipapi = () => json(ipapiBody({ is_datacenter: true, is_vpn: true, vpn: { service: 'ExampleVPN' }, company: { name: 'ExampleHost', type: 'hosting' } }));
    const { body } = await assess(h);
    const report = body.report as AssessmentReport;
    expect(report).toMatchObject({ decision: 'ALLOW', assurance: 'standard' });
    expect(reasons(report)).toContain('HOSTING_NETWORK_VERIFIED');
    expect(signalOf(report, 'network.anonymizer').value).toBe('ExampleVPN');
  });
});

describe('challenges and abuse controls', () => {
  it('challenges when bot verification fails, and issues no session', async () => {
    h = await harness();
    h.world.turnstile = () => json({ success: false, 'error-codes': ['invalid-input-response'] });
    const { response, body, sessionCookie } = await assess(h);
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ admitted: false, report: { decision: 'CHALLENGE' } });
    expect(reasons(body.report)).toContain('BOT_VERIFICATION_FAILED');
    expect(sessionCookie).toBeUndefined();
    expect(h.store.events.map((e) => e.type)).toContain('challenge_failed');
  });

  it('challenges forged client evidence when it is also unverified', async () => {
    h = await harness();
    h.world.turnstile = () => json({ success: false, 'error-codes': ['invalid-input-response'] });
    const { body } = await assess(h, {}, { client: { userAgent: 'Mozilla/5.0 (definitely a different browser)' } });
    expect(reasons(body.report)).toContain('CLIENT_EVIDENCE_INCONSISTENT');
  });

  it('denies after repeated challenge failures', async () => {
    h = await harness();
    h.world.turnstile = () => json({ success: false, 'error-codes': ['invalid-input-response'] });
    let last;
    for (let i = 0; i < THRESHOLDS.challengeFailuresPerWindow; i++) last = await assess(h);
    expect(last?.response.statusCode).toBe(403);
    expect(last?.body.report.decision).toBe('DENY');
    expect(reasons(last?.body.report)).toContain('REPEATED_CHALLENGE_FAILURE');
  });

  it('denies an assessment flood and stops spending provider quota on it', async () => {
    h = await harness();
    for (let i = 0; i < THRESHOLDS.assessmentsPerWindow; i++) await assess(h);
    h.world.calls.length = 0;
    const { response, body } = await assess(h);
    expect(response.statusCode).toBe(403);
    expect(reasons(body.report)).toContain('ASSESSMENT_FLOOD');
    expect(h.world.calls).toEqual([]);
    // Someone else, on another address, is unaffected.
    expect((await assess(h, { ip: '203.0.113.99' })).body.admitted).toBe(true);
    // And the limit lifts when the window passes.
    h.clock.now += (THRESHOLDS.rateWindowMinutes + 1) * 60_000;
    expect((await assess(h)).body.admitted).toBe(true);
  });

  it('caches enrichment so reloading does not multiply provider calls', async () => {
    h = await harness();
    await assess(h);
    await assess(h);
    await assess(h);
    expect(h.world.calls.filter((url) => url.includes('ipapi.is'))).toHaveLength(1);
    expect(h.world.calls.filter((url) => url.includes('abuseipdb'))).toHaveLength(1);
  });

  it('rate-limits the API as a whole', async () => {
    h = await harness();
    let status = 200;
    for (let i = 0; i < 245 && status !== 429; i++) status = (await get('/api/policy')).statusCode;
    expect(status).toBe(429);
    expect((await get('/healthz')).statusCode).toBe(200);
  });

  it('rejects a cross-site POST', async () => {
    h = await harness();
    const response = await h.app.inject({ method: 'POST', url: '/api/assessments', headers: requestHeaders({ headers: { origin: 'https://evil.test' } }), payload: {} });
    expect(response.statusCode).toBe(403);
    expect(h.store.assessments.size).toBe(0);
    const sameSite = await h.app.inject({ method: 'POST', url: '/api/assessments', headers: requestHeaders({ headers: { origin: 'https://portfolio.test' } }), payload: { botToken: 't' } });
    expect(sameSite.statusCode).toBe(201);
  });
});

describe('the gate is enforced by the server', () => {
  it('serves the gate, and only the gate, to a request with no session', async () => {
    h = await harness();
    for (const path of ['/', '/program', '/work/bivvi', '/admin']) {
      const page = await get(path);
      expect(page.body).toContain('<title>gate</title>');
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.headers['content-security-policy']).toContain('challenges.cloudflare.com');
    }
    expect((await get('/static/gate-abc.js')).statusCode).toBe(200);
    expect((await get('/assets/favicon.svg')).statusCode).toBe(200);
    // The portfolio's own code and content are not handed out.
    expect((await get('/static/app-def.js')).statusCode).toBe(401);
    expect((await get('/assets/bivvi-logo.png')).statusCode).toBe(401);
    expect((await get('/api/me/assessment')).statusCode).toBe(401);
    expect((await get('/api/session')).statusCode).toBe(401);
  });

  it('serves the portfolio once a session exists, without the third-party script allowance', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const page = await get('/work/bivvi', cookies);
    expect(page.body).toContain('<title>portfolio</title>');
    expect(page.headers['content-security-policy']).not.toContain('cloudflare');
    expect((await get('/static/app-def.js', cookies)).body).toContain('the portfolio');
    expect((await get('/static/app-def.js', cookies)).headers['cache-control']).toContain('private');
  });

  it('opens the script policy to the analytics vendor only when it is configured, and never on the gate', async () => {
    h = await harness();
    const off = (await get('/api/gate/config')).json();
    expect(off.visitorAnalytics).toEqual({ provider: 'dreamdata', configured: false, cookieless: true });
    expect(off.providers.find((p: { name: string }) => p.name === 'Dreamdata').configured).toBe(false);
    const { cookies: plain } = await assess(h);
    expect((await get('/', plain)).headers['content-security-policy']).not.toMatch(/dreamdata|drda/);
    await h.app.close();

    h = await harness({ config: { dreamdata: { writeKey: 'test-write-key', cookieless: true } } });
    expect((await get('/api/gate/config')).json().visitorAnalytics).toEqual({ provider: 'dreamdata', configured: true, writeKey: 'test-write-key', cookieless: true });
    expect((await get('/')).headers['content-security-policy']).not.toMatch(/dreamdata|drda/);
    const { cookies } = await assess(h);
    const policy = String((await get('/', cookies)).headers['content-security-policy']);
    expect(policy).toContain("script-src 'self' https://cdn.dreamdata.cloud https://cdn.drda.io");
    expect(policy).toContain("connect-src 'self' https://cdn.dreamdata.cloud https://cdn.drda.io");
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain('cloudflare');
    await h.app.close();

    h = await harness({ config: { dreamdata: { writeKey: 'test-write-key', cookieless: false } } });
    const strict = await assess(h);
    expect((await get('/', strict.cookies)).headers['content-security-policy']).not.toContain('drda.io');
  });

  it('cannot be walked out of the build directory', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    for (const path of ['/../package.json', '/static/../../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/.vite/manifest.json']) {
      const response = await get(path, cookies);
      expect(response.body).not.toContain('"dependencies"');
      expect(response.body).not.toContain('root:');
    }
  });

  it('rejects a tampered, forged or foreign-key session cookie', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const [body, signature] = (cookies.pd_session as string).split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = `${Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 999_999 })).toString('base64url')}.${signature}`;
    for (const value of [forged, `${body}.AAAA`, 'garbage', `${body}`]) {
      expect((await get('/api/session', { pd_session: value })).statusCode).toBe(401);
      expect((await get('/', { pd_session: value })).body).toContain('<title>gate</title>');
    }
    expect(h.store.events.some((e) => e.type === 'session_rejected' && e.detail === 'bad_signature')).toBe(true);
  });

  it('expires sessions, and a new evaluation renews access', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    expect((await get('/api/session', cookies)).statusCode).toBe(200);
    h.clock.now += 61 * 60_000;
    expect((await get('/api/session', cookies)).json()).toMatchObject({ reason: 'expired' });
    expect((await get('/', cookies)).body).toContain('<title>gate</title>');
    const renewed = await assess(h, { cookies });
    expect(renewed.body.admitted).toBe(true);
    expect(renewed.body.report.signals.find((s: Signal) => s.key === 'session.continuity').value).toMatch(/no longer valid/);
    expect((await get('/api/session', renewed.cookies)).statusCode).toBe(200);
  });

  it('refuses a session cookie replayed from a different client', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const replay = await h.app.inject({ method: 'GET', url: '/api/session', headers: requestHeaders({ cookies, ua: 'curl/8.4.0' }) });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().reason).toBe('client_changed');
  });

  it('ends a session on request, and a revoked cookie stops working', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    await h.app.inject({ method: 'POST', url: '/api/session/end', headers: requestHeaders({ cookies }) });
    h.clock.now += 16_000; // past the validity cache
    expect((await get('/api/session', cookies)).json()).toMatchObject({ reason: 'revoked' });
  });

  it('never leaks internals in an error', async () => {
    h = await harness();
    const response = await h.app.inject({ method: 'POST', url: '/api/assessments', headers: { ...requestHeaders(), 'content-type': 'application/json' }, payload: '{not json' });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/SyntaxError|at JSON|node_modules/);
    expect(response.json().requestId).toBeTruthy();
  });
});

describe('each visitor sees only their own report', () => {
  it('returns the report the session points at, with nothing addressable by id', async () => {
    h = await harness();
    const alice = await assess(h, { ip: '203.0.113.7' });
    const bob = await assess(h, { ip: '198.18.5.9', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15' });

    const aliceReport = (await get('/api/me/assessment', alice.cookies)).json() as AssessmentReport;
    expect(aliceReport.id).toBe(alice.body.report.id);
    expect(JSON.stringify(aliceReport)).not.toContain('198.18.5');
    expect(signalOf(aliceReport, 'network.ip').value).toBe('203.0.113.7');

    for (const path of [`/api/me/assessment/${bob.body.report.id}`, `/api/assessments/${bob.body.report.id}`, `/api/me/assessment?id=${bob.body.report.id}`]) {
      const response = await get(path, alice.cookies);
      expect(JSON.stringify(response.json())).not.toContain(bob.body.report.id);
    }
  });

  it('shows the stored, truncated address if the cookie turns up on another connection', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const elsewhere = await h.app.inject({ method: 'GET', url: '/api/me/assessment', headers: requestHeaders({ cookies, ip: '198.18.0.1' }) });
    expect(signalOf(elsewhere.json(), 'network.ip').value).toBe('203.0.113.0/24');
  });
});

describe('fingerprinting is opt-in', () => {
  it('stores nothing and sets no cookie without explicit consent', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    for (const payload of [{ fingerprint: FINGERPRINT }, { consent: 'yes', fingerprint: FINGERPRINT }, { consent: false, fingerprint: FINGERPRINT }]) {
      const response = await submitFingerprint(cookies, payload);
      expect(response.statusCode).toBe(400);
      expect(response.cookies).toEqual([]);
    }
    expect(h.store.fingerprints.size).toBe(0);
    expect((await submitFingerprint({})).statusCode).toBe(401);
  });

  it('with consent: describes each trait, keys the stored hashes, and sets a recognition cookie', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const response = await submitFingerprint(cookies);
    const report = response.json() as FingerprintReport;
    expect(response.statusCode).toBe(201);
    expect(report.recognition.status).toBe('new');
    expect(report.signals.find((s) => s.key === 'fingerprint.gpu')).toMatchObject({ value: 'ANGLE (Example GPU)', method: 'script', kind: 'claim' });
    expect(report.signals.find((s) => s.key === 'fingerprint.audio')?.note).toBeTruthy();
    expect(report.signals.find((s) => s.key === 'fingerprint.fonts')).toMatchObject({ status: 'unavailable', value: null });
    expect(response.cookies.find((c) => c.name === 'pd_browser')).toMatchObject({ httpOnly: true });
    const stored = [...h.store.fingerprints.values()][0];
    expect(stored?.libraryHash).not.toBe(FINGERPRINT.libraryHash);
    // It becomes part of the visitor's own report.
    expect(((await get('/api/me/assessment', cookies)).json() as AssessmentReport).fingerprint?.recognition.status).toBe('new');
  });

  it('flags a device clock that disagrees with the network location', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    const report = (await submitFingerprint(cookies, { consent: true, fingerprint: { ...FINGERPRINT, timezone: 'Europe/Berlin' } })).json() as FingerprintReport;
    expect(report.inconsistencies.map((i) => i.key)).toEqual(['timezone']);
    expect(report.inconsistencies[0]).toMatchObject({ serverSees: expect.stringContaining('America/New_York') });
  });

  it('recognizes a returning browser by cookie, and hedges on a fingerprint alone', async () => {
    h = await harness();
    const first = await assess(h);
    const firstFp = await submitFingerprint(first.cookies);
    const browserCookie = firstFp.cookies.find((c) => c.name === 'pd_browser')?.value as string;

    h.clock.now += 86_400_000;
    const second = await assess(h);
    const withCookie = (await submitFingerprint({ ...second.cookies, pd_browser: browserCookie })).json() as FingerprintReport;
    expect(withCookie.recognition).toMatchObject({ status: 'recognized', confidence: 'high', priorVisits: 1 });

    h.clock.now += 86_400_000;
    const third = await assess(h);
    const cleared = (await submitFingerprint(third.cookies)).json() as FingerprintReport;
    expect(cleared.recognition).toMatchObject({ status: 'probable', confidence: 'medium' });

    h.clock.now += 86_400_000;
    const elsewhere = await assess(h, { ip: '198.18.7.7' });
    h.world.ipapi = () => json(ipapiBody({ ip: '198.18.7.7', asn: { asn: 64999, org: 'Other Net', type: 'isp' } }));
    const far = (await submitFingerprint(elsewhere.cookies, undefined, { ip: '198.18.7.7' })).json() as FingerprintReport;
    expect(far.recognition.status).toMatch(/possible|probable/);
    expect(far.recognition.caveat).toMatch(/browsers, not people/);
  });

  it('withdrawing consent deletes the fingerprint and the cookie', async () => {
    h = await harness();
    const { cookies } = await assess(h);
    await submitFingerprint(cookies);
    const response = await h.app.inject({ method: 'DELETE', url: '/api/me/fingerprint', headers: requestHeaders({ cookies }) });
    expect(response.cookies.find((c) => c.name === 'pd_browser')?.value).toBe('');
    expect(h.store.fingerprints.size).toBe(0);
    expect(((await get('/api/me/assessment', cookies)).json() as AssessmentReport).fingerprint).toBeUndefined();
  });
});

describe('administration', () => {
  const login = (password: string, ip = VISITOR_IP) => h.app.inject({ method: 'POST', url: '/api/admin/login', headers: requestHeaders({ ip }), payload: { password } });

  it('does not exist unless a password hash is configured', async () => {
    h = await harness({ configured: { admin: false } });
    expect((await login(ADMIN_PASSWORD)).statusCode).toBe(404);
    expect((await get('/api/admin/overview')).statusCode).toBe(404);
  });

  it('keeps analytics behind the admin session, which a visitor session is not', async () => {
    h = await harness();
    const visitor = await assess(h);
    expect((await get('/api/admin/overview', visitor.cookies)).statusCode).toBe(401);
    expect((await get('/api/admin/assessments', visitor.cookies)).statusCode).toBe(401);

    const ok = await login(ADMIN_PASSWORD);
    expect(ok.statusCode).toBe(200);
    const admin = ok.cookies.find((c) => c.name === 'pd_admin');
    expect(admin).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
    const overview = (await get('/api/admin/overview?days=7', { pd_admin: admin?.value as string })).json();
    expect(overview).toMatchObject({ total: 1, misclassifiedFailures: 0 });
    expect(overview.providers.map((p: { provider: string }) => p.provider)).toEqual(['abuseipdb', 'ipapi.is', 'ipinfo', 'torproject', 'turnstile']);
    const rows = (await get('/api/admin/assessments', { pd_admin: admin?.value as string })).json();
    expect(rows).toHaveLength(1);
    // Even the administrator's view carries no full address.
    expect(JSON.stringify(rows)).not.toContain(VISITOR_IP);
    expect(JSON.stringify(overview)).not.toContain(VISITOR_IP);
  });

  it('locks out repeated wrong passwords, including the right one', async () => {
    h = await harness();
    for (let i = 0; i < 5; i++) expect((await login('wrong password')).statusCode).toBe(401);
    expect((await login(ADMIN_PASSWORD)).statusCode).toBe(429);
    expect((await login(ADMIN_PASSWORD, '203.0.113.200')).statusCode).toBe(200);
    expect(h.store.events.filter((e) => e.type === 'admin_login_failed')).toHaveLength(5);
  });

  it('lets an administrator flag a decision for false-positive review', async () => {
    h = await harness();
    h.world.turnstile = () => json({ success: false, 'error-codes': ['invalid-input-response'] });
    const { body } = await assess(h);
    const admin = { pd_admin: (await login(ADMIN_PASSWORD)).cookies.find((c) => c.name === 'pd_admin')?.value as string };
    const flag = await h.app.inject({ method: 'POST', url: `/api/admin/assessments/${body.report.id}/investigation`, headers: requestHeaders({ cookies: admin }), payload: { status: 'open', note: 'Looks like a real browser' } });
    expect(flag.statusCode).toBe(200);
    const overview = (await get('/api/admin/overview', admin)).json();
    expect(overview.investigations).toEqual({ open: 1, total: 1 });
    expect((await h.app.inject({ method: 'POST', url: '/api/admin/assessments/nope/investigation', headers: requestHeaders({ cookies: admin }), payload: { status: 'open', note: 'x' } })).statusCode).toBe(404);
  });
});

describe('retention', () => {
  it('deletes assessments, fingerprints, sessions and events past the retention period', async () => {
    h = await harness();
    const old = await assess(h);
    await submitFingerprint(old.cookies);
    h.clock.now += 31 * 86_400_000;
    const recent = await assess(h, { ip: '203.0.113.50' });
    await runRetention(h.store, 30, h.clock.now, () => undefined);
    expect([...h.store.assessments.keys()]).toEqual([recent.body.report.id]);
    expect(h.store.fingerprints.size).toBe(0);
    expect(h.store.sessions.size).toBe(1);
    expect(h.store.calls.every((c) => c.assessmentId === recent.body.report.id)).toBe(true);
  });
});

describe('public gateway health', () => {
  const health = async () => (await get('/api/gateway/health')).json();

  it('publishes nothing about outcomes until there are enough evaluations to hide an individual in', async () => {
    h = await harness();
    await assess(h);
    await assess(h, { ip: '203.0.113.60' });
    const summary = await health();
    expect(summary).toMatchObject({ sufficient: false, evaluations: null, decisions: null, standardAssurance: null, latency: null, minimumToPublish: 10 });
    // Provider state describes the service, not a visitor, so it is always shown.
    expect(summary.providers).toContainEqual({ name: 'turnstile', state: 'healthy' });
  });

  it('publishes rounded aggregates and no per-visitor detail once there are', async () => {
    h = await harness({ configured: { abuse: false } });
    h.world.turnstile = () => json({ success: false, 'error-codes': ['invalid-input-response'] });
    await assess(h, { ip: '203.0.113.90' });
    h.world.turnstile = () => json({ success: true, action: 'gate' });
    for (let i = 0; i < 13; i++) await assess(h, { ip: `203.0.113.${100 + i}` });
    const summary = await health();
    expect(summary).toMatchObject({ sufficient: true, evaluations: 10, failuresCountedAsPasses: 0 });
    expect(summary.decisions).toEqual({ allow: 93, challenge: 7, deny: 0 });
    expect(summary.providers).toContainEqual({ name: 'abuseipdb', state: 'not_configured' });
    const text = JSON.stringify(summary);
    for (const leak of ['203.0.113', 'Example Broadband', 'AS64500', 'Chrome', 'Columbus']) expect(text).not.toContain(leak);
    expect(Object.keys(summary).sort()).toEqual(['decisions', 'evaluations', 'failuresCountedAsPasses', 'generatedAt', 'latency', 'minimumToPublish', 'policyVersion', 'providers', 'standardAssurance', 'sufficient', 'windowDays']);
  });

  it('needs no session and is cached', async () => {
    h = await harness();
    const first = await get('/api/gateway/health');
    expect(first.statusCode).toBe(200);
    for (let i = 0; i < 12; i++) await assess(h, { ip: `203.0.113.${100 + i}` });
    expect((await health()).sufficient).toBe(false);
    h.clock.now += 61_000;
    expect((await health()).sufficient).toBe(true);
  });
});

describe('published configuration', () => {
  it('tells the gate which providers are real on this deployment', async () => {
    h = await harness({ configured: { abuse: false } });
    const config = (await get('/api/gate/config')).json();
    expect(config.botVerification).toEqual({ provider: 'turnstile', configured: true, siteKey: 'site-key' });
    expect(config.providers.find((p: { name: string }) => p.name === 'AbuseIPDB').configured).toBe(false);
    expect(JSON.stringify(config)).not.toContain('secret-key');
    expect((await get('/api/policy')).json().version).toBe(POLICY_VERSION);
  });

  it('reports readiness, and unreadiness when the store is down', async () => {
    h = await harness();
    expect((await get('/readyz')).json()).toMatchObject({ status: 'ok', store: 'memory' });
    h.store.ping = async () => {
      throw new Error('down');
    };
    expect((await get('/readyz')).statusCode).toBe(503);
  });
});
