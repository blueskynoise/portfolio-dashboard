import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './admin/auth';
import { computeOverview, deriveFindings, percentile, providerHealth } from './admin/metrics';
import { hmacIp, isPublicIp, resolveClientIp, truncateIp } from './clientIp';
import { loadConfig } from './config';
import { correlate, type CurrentVisit } from './correlation';
import { checkConsistency, type RequestEvidence } from './evidence';
import { findInconsistencies, sanitizeSubmission } from './fingerprint';
import { requestJson } from './http';
import { DailyBudget } from './providers/budget';
import { parseIpapi } from './providers/ipapi';
import { TorExitList } from './providers/tor';
import { TurnstileProvider } from './providers/turnstile';
import { SlidingCounter } from './rateLimit';
import { issueToken, verifyToken } from './sessions';
import type { AssessmentRecord, FingerprintRecord, ProviderCallRecord } from './store/types';
import { ipapiBody, json } from './testing';
import { parseUserAgent } from './ua';

describe('client address resolution', () => {
  const inputs = (headers: Record<string, string>, socket = '10.0.0.5') => ({ socketAddress: socket, header: (name: string) => headers[name] });

  it('ignores every forwarding header when no proxy is trusted', () => {
    const resolved = resolveClientIp('socket', 1, inputs({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' }, '198.51.100.9'));
    expect(resolved.ip).toBe('198.51.100.9');
  });

  it('takes X-Real-IP from the platform edge and nothing from X-Forwarded-For', () => {
    expect(resolveClientIp('x-real-ip', 1, inputs({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.7' })).ip).toBe('203.0.113.7');
  });

  it('reads X-Forwarded-For from the right, so a client-supplied prefix cannot win', () => {
    const forged = '6.6.6.6, 7.7.7.7, 203.0.113.7';
    expect(resolveClientIp('x-forwarded-for', 1, inputs({ 'x-forwarded-for': forged })).ip).toBe('203.0.113.7');
    expect(resolveClientIp('x-forwarded-for', 2, inputs({ 'x-forwarded-for': forged })).ip).toBe('7.7.7.7');
  });

  it('returns no address rather than a guess when the header is missing or not an address', () => {
    expect(resolveClientIp('x-real-ip', 1, inputs({})).ip).toBeNull();
    expect(resolveClientIp('x-real-ip', 1, inputs({ 'x-real-ip': '<script>' })).ip).toBeNull();
    expect(resolveClientIp('x-forwarded-for', 3, inputs({ 'x-forwarded-for': '203.0.113.7' })).ip).toBeNull();
  });

  it('unwraps IPv4-mapped IPv6 and recognizes non-public ranges', () => {
    expect(resolveClientIp('socket', 1, inputs({}, '::ffff:203.0.113.7')).ip).toBe('203.0.113.7');
    for (const ip of ['10.1.2.3', '192.168.1.1', '172.20.0.1', '127.0.0.1', '100.64.0.1', '::1', 'fd00::1']) expect(isPublicIp(ip)).toBe(false);
    for (const ip of ['203.0.113.7', '8.8.8.8', '2001:db8::1']) expect(isPublicIp(ip)).toBe(true);
  });

  it('truncates for storage and hashes with a key', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(truncateIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(hmacIp('203.0.113.7', 'a')).not.toBe(hmacIp('203.0.113.7', 'b'));
    expect(hmacIp('203.0.113.7', 'a')).toBe(hmacIp('203.0.113.7', 'a'));
  });
});

describe('session tokens', () => {
  const secret = 'a-long-enough-secret-for-testing-purposes';
  const payload = { sid: 's1', aid: 'a1', exp: 2_000_000_000 };

  it('round-trips a valid token', () => {
    expect(verifyToken(issueToken(payload, secret), secret, 0)).toEqual({ ok: true, payload });
  });

  it('rejects tampering, the wrong key, expiry and garbage', () => {
    const token = issueToken(payload, secret);
    const [body, signature] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, aid: 'someone-else' })).toString('base64url');
    expect(verifyToken(`${forgedBody}.${signature}`, secret, 0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyToken(token, 'another-secret', 0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyToken(`${body}.${signature}.extra`, secret, 0)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('nonsense', secret, 0)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken(undefined, secret, 0)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyToken(token, secret, payload.exp * 1000)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('rate limiting and budgets', () => {
  it('counts within a sliding window and forgets afterwards', () => {
    let now = 0;
    const counter = new SlidingCounter(1000, () => now);
    expect(counter.hit('a')).toBe(1);
    expect(counter.hit('a')).toBe(2);
    expect(counter.count('b')).toBe(0);
    expect(counter.retryAfterSeconds('a')).toBe(1);
    now = 1001;
    expect(counter.count('a')).toBe(0);
    counter.prune();
    expect(counter.keys).toBe(0);
  });

  it('a daily budget refuses once spent and resets with the UTC day', () => {
    let now = Date.UTC(2026, 0, 1, 23, 0);
    const budget = new DailyBudget(2, () => now);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    now += 2 * 3_600_000;
    expect(budget.take()).toBe(true);
  });
});

describe('outbound HTTP', () => {
  it('reports a timeout as a timeout', async () => {
    const never = (_: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const outcome = await requestJson(never, 'https://provider.test', {}, { timeoutMs: 30 });
    expect(outcome).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('retries once on a 5xx when asked, and not on a 4xx', async () => {
    let calls = 0;
    const flaky = async () => (++calls === 1 ? json({}, 503) : json({ fine: true }));
    expect(await requestJson(flaky, 'https://provider.test', {}, { timeoutMs: 500, retry: true })).toMatchObject({ ok: true, body: { fine: true } });
    calls = 0;
    const denied = async () => {
      calls++;
      return json({}, 403);
    };
    expect(await requestJson(denied, 'https://provider.test', {}, { timeoutMs: 500, retry: true })).toMatchObject({ ok: false, kind: 'http', status: 403 });
    expect(calls).toBe(1);
  });

  it('treats an unparseable 200 as a failure', async () => {
    const html = async () => new Response('<html>maintenance</html>', { status: 200 });
    expect(await requestJson(html, 'https://provider.test', {}, { timeoutMs: 500 })).toMatchObject({ ok: false, kind: 'parse' });
  });
});

describe('Tor exit list', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => `198.51.100.${i}`).join('\n');

  it('rejects an implausibly small list instead of concluding nobody uses Tor', async () => {
    let body = list(150);
    const tor = new TorExitList({ fetch: async () => new Response(body), timeoutMs: 100 });
    expect(await tor.refresh()).toBe(true);
    expect(tor.check('198.51.100.3').data).toBe(true);
    body = '198.51.100.3\n';
    expect(await tor.refresh()).toBe(false);
    // The good list is kept.
    expect(tor.size).toBe(150);
    expect(tor.check('198.51.100.99').data).toBe(true);
  });

  it('says it has no answer before the first successful load', async () => {
    const tor = new TorExitList({ fetch: async () => new Response('', { status: 500 }), timeoutMs: 100 });
    await tor.refresh();
    expect(tor.check('198.51.100.3')).toMatchObject({ data: null, result: { status: 'error' } });
  });

  it('keeps answering from an old list but reports its age', async () => {
    let now = 0;
    let fail = false;
    const tor = new TorExitList({ fetch: async () => (fail ? new Response('', { status: 502 }) : new Response(list(150))), timeoutMs: 100, now: () => now });
    await tor.refresh();
    fail = true;
    now = 7 * 3_600_000;
    await tor.refresh();
    const check = tor.check('203.0.113.1');
    expect(check.data).toBe(false);
    expect(check.result.ageSeconds).toBe(7 * 3600);
    expect(check.result.detail).toMatch(/stale/);
  });
});

describe('Turnstile validation', () => {
  const provider = (body: unknown, extra: object = {}) => new TurnstileProvider({ siteKey: 'k', secretKey: 's', fetch: async () => json(body), timeoutMs: 100, ...extra });

  it('passes only a successful token for our action', async () => {
    expect((await provider({ success: true, action: 'gate' }).verify('t', null)).data?.outcome).toBe('passed');
    expect((await provider({ success: true, action: 'login' }).verify('t', null)).data).toMatchObject({ outcome: 'failed', errorCodes: ['action-mismatch'] });
    expect((await provider({ success: true, action: 'gate', hostname: 'evil.test' }, { expectedHostname: 'mine.test' }).verify('t', null)).data?.outcome).toBe('failed');
    expect((await provider({ success: false, 'error-codes': ['timeout-or-duplicate'] }).verify('t', null)).data?.outcome).toBe('failed');
  });

  it('separates the visitor failing from the provider or our configuration failing', async () => {
    expect((await provider({ success: false, 'error-codes': ['internal-error'] }).verify('t', null)).data?.outcome).toBe('provider_error');
    expect((await provider({ success: false, 'error-codes': ['invalid-input-secret'] }).verify('t', null)).data?.outcome).toBe('provider_error');
    expect((await provider({ unexpected: true }).verify('t', null)).data?.outcome).toBe('provider_error');
    expect((await provider({ success: true, action: 'gate' }).verify(undefined, null)).data?.outcome).toBe('missing');
    const unconfigured = new TurnstileProvider({ fetch: async () => json({}), timeoutMs: 100 });
    expect((await unconfigured.verify('t', null)).data?.outcome).toBe('unconfigured');
  });
});

describe('provider parsing', () => {
  it('reads an ipapi.is answer and refuses a body that is not one', () => {
    const parsed = parseIpapi(ipapiBody({ is_vpn: true, vpn: { service: 'ExampleVPN' }, is_datacenter: true, datacenter: { datacenter: 'ExampleHost' } }));
    expect(parsed).toMatchObject({ asn: 'AS64500', companyName: 'Example Broadband', companyType: 'isp', timezone: 'America/New_York', isVpn: true, vpnService: 'ExampleVPN', datacenterName: 'ExampleHost' });
    expect(parseIpapi({ error: 'Invalid API key' })).toBeNull();
    expect(parseIpapi({ ip: '1.2.3.4' })).toBeNull();
    expect(parseIpapi(null)).toBeNull();
  });

  it('labels user agents without pretending to identify them', () => {
    expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15')).toMatchObject({ family: 'Safari', major: '18', os: 'macOS' });
    expect(parseUserAgent('curl/8.4.0').family).toBe('HTTP client');
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36').family).toBe('Headless Chrome');
    expect(parseUserAgent(undefined).family).toBe('none');
    expect(parseUserAgent('something new').family).toBe('unknown');
  });
});

describe('admin password', () => {
  it('verifies the right password only', () => {
    const stored = hashPassword('a sufficiently long password');
    expect(verifyPassword('a sufficiently long password', stored)).toBe(true);
    expect(verifyPassword('a sufficiently long passwore', stored)).toBe(false);
    expect(verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(verifyPassword('anything', 'scrypt:1:00:00')).toBe(false);
  });
});

describe('configuration', () => {
  it('refuses to start in production without secrets, listing every problem', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET[\s\S]*DATABASE_URL/);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', DATABASE_URL: 'postgres://x' })).toThrow(/at least 32/);
  });

  it('requires both halves of the Turnstile key pair', () => {
    expect(() => loadConfig({ TURNSTILE_SITE_KEY: 'only-one' })).toThrow(/set together/);
  });

  it('defaults to trusting only the socket locally and X-Real-IP in production', () => {
    expect(loadConfig({}).clientIpSource).toBe('socket');
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://x' }).clientIpSource).toBe('x-real-ip');
  });
});

describe('script-versus-request consistency', () => {
  const request = { userAgent: 'UA-1', clientHintMobile: '?0', clientHintPlatform: '"Windows"' } as RequestEvidence;

  it('has no opinion when there is nothing to compare', () => {
    expect(checkConsistency(request, undefined).consistent).toBeNull();
    expect(checkConsistency(request, {}).consistent).toBeNull();
  });

  it('detects a script that disagrees with the wire', () => {
    expect(checkConsistency(request, { userAgent: 'UA-1', uaData: { mobile: false, platform: 'Windows' } }).consistent).toBe(true);
    expect(checkConsistency(request, { userAgent: 'UA-2' })).toMatchObject({ consistent: false });
    expect(checkConsistency(request, { userAgent: 'UA-1', uaData: { mobile: true } }).consistent).toBe(false);
  });
});

describe('fingerprint submissions', () => {
  it('keeps known fields, bounds sizes and drops everything else', () => {
    const clean = sanitizeSubmission({
      libraryHash: 'abcdef123456',
      webglRenderer: 'x'.repeat(500),
      hardwareConcurrency: 1e9,
      languages: ['en-US', 42, 'fr'],
      permissions: { camera: 'prompt', '<img onerror=x>': 'granted' },
      evil: '<script>',
    });
    expect(clean?.webglRenderer).toHaveLength(160);
    expect(clean?.hardwareConcurrency).toBeUndefined();
    expect(clean?.languages).toEqual(['en-US', 'fr']);
    expect(clean?.permissions).toEqual({ camera: 'prompt' });
    expect(clean).not.toHaveProperty('evil');
  });

  it('rejects a submission without a usable hash', () => {
    expect(sanitizeSubmission({})).toBeNull();
    expect(sanitizeSubmission({ libraryHash: '<script>alert(1)</script>' })).toBeNull();
    expect(sanitizeSubmission('nope')).toBeNull();
  });

  it('reports clock-versus-network and platform mismatches without calling them proof', () => {
    const request = { acceptLanguage: 'en-US,en;q=0.9' } as RequestEvidence;
    const ua = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36');
    const found = findInconsistencies({ libraryHash: 'abcdef', timezone: 'Europe/Berlin', languages: ['de-DE'], platform: 'MacIntel' }, request, ua, 'America/New_York');
    expect(found.map((f) => f.key)).toEqual(['timezone', 'language', 'platform']);
    expect(found[0]?.reading).toMatch(/VPN/);
    expect(findInconsistencies({ libraryHash: 'abcdef', timezone: 'America/New_York', languages: ['en-US'], platform: 'Win32' }, request, ua, 'America/New_York')).toEqual([]);
    // Unknown on either side is not a mismatch.
    expect(findInconsistencies({ libraryHash: 'abcdef', timezone: 'Europe/Berlin' }, request, ua, null)).toEqual([]);
  });
});

describe('visit correlation', () => {
  const visit = (overrides: Partial<CurrentVisit> = {}): CurrentVisit => ({
    cookieHash: 'cookie-1', libraryHash: 'fp-1', canvasHash: 'canvas-1', webglHash: 'webgl-1', audioHash: 'audio-1', asn: 'AS64500', ipPrefix: '203.0.113.0/24', browserFamily: 'Chrome', osFamily: 'Windows', ...overrides,
  });
  const earlier = (overrides: Partial<FingerprintRecord> = {}): FingerprintRecord => ({
    assessmentId: 'a0', createdAt: new Date('2026-11-01T00:00:00Z'), cookieHash: 'cookie-1', libraryHash: 'fp-1', canvasHash: 'canvas-1', webglHash: 'webgl-1', audioHash: 'audio-1', ipPrefix: '203.0.113.0/24', asn: 'AS64500', browserFamily: 'Chrome', osFamily: 'Windows', recognition: 'new', report: {} as FingerprintRecord['report'], ...overrides,
  });

  it('a returning cookie is strong evidence, even if the fingerprint drifted', () => {
    const same = correlate(visit(), [earlier()]);
    expect(same).toMatchObject({ status: 'recognized', confidence: 'high', priorVisits: 1 });
    const drifted = correlate(visit({ libraryHash: 'fp-2', canvasHash: 'canvas-2' }), [earlier()]);
    expect(drifted.status).toBe('recognized');
    expect(drifted.evidence.some((e) => !e.supports && /changed/.test(e.text))).toBe(true);
  });

  it('a fingerprint match without a cookie is probable only on the same network', () => {
    expect(correlate(visit({ cookieHash: null }), [earlier({ cookieHash: 'other' })])).toMatchObject({ status: 'probable', confidence: 'medium' });
    expect(correlate(visit({ cookieHash: null, asn: 'AS1', ipPrefix: '198.51.100.0/24' }), [earlier({ cookieHash: 'other' })])).toMatchObject({ status: 'possible', confidence: 'low' });
  });

  it('refuses to link identical iPhones on a fingerprint alone', () => {
    const result = correlate(visit({ cookieHash: null, osFamily: 'iOS', browserFamily: 'Safari' }), [earlier({ cookieHash: 'other', osFamily: 'iOS' })]);
    expect(result).toMatchObject({ status: 'possible', confidence: 'low' });
    expect(result.caveat).toMatch(/too low/);
  });

  it('treats a canvas-only match as similarity, not continuity', () => {
    const result = correlate(visit({ cookieHash: null, libraryHash: 'fp-9' }), [earlier({ cookieHash: 'other' })]);
    expect(result).toMatchObject({ status: 'similar', confidence: 'none', priorVisits: 0 });
  });

  it('says "new" when nothing matches, and never claims to identify a person', () => {
    const result = correlate(visit({ cookieHash: null }), []);
    expect(result.status).toBe('new');
    for (const r of [result, correlate(visit(), [earlier()])]) expect(r.caveat).toMatch(/browsers, not people/);
  });
});

describe('operational metrics', () => {
  const at = new Date('2026-11-14T12:00:00Z');
  const record = (id: string, overrides: Partial<AssessmentRecord> = {}): AssessmentRecord => ({
    id, requestId: id, createdAt: at, policyVersion: '2026.11.1', decision: 'ALLOW', assurance: 'standard', reasonCodes: ['BASELINE_SATISFIED'],
    report: { signals: [{ key: 'network.asn', label: 'Network operator' }] } as AssessmentRecord['report'],
    ipHmac: 'h', ipPrefix: '203.0.113.0/24', asn: 'AS64500', asOrg: 'Example', country: 'US', browserFamily: 'Chrome', browserMajor: '140', osFamily: 'Windows',
    botStatus: 'passed', sessionContinuity: 'new', totalMs: 100, signalStatus: { 'network.asn': 'enriched', 'device.posture': 'not_measurable' }, orgName: null, orgType: null, maxEnrichmentAgeSeconds: 0, ...overrides,
  });
  const call = (assessmentId: string, provider: string, status: ProviderCallRecord['status'], latencyMs = 50): ProviderCallRecord => ({ assessmentId, createdAt: at, provider, status, latencyMs, ageSeconds: null, detail: null });
  const overview = (assessments: AssessmentRecord[], calls: ProviderCallRecord[] = []) => computeOverview({ assessments, calls, events: [], investigations: [], fingerprints: [], now: at, windowDays: 7 });

  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it('measures provider reliability against calls that actually went out', () => {
    const [p] = providerHealth([call('a', 'ipapi.is', 'ok'), call('b', 'ipapi.is', 'cache'), call('c', 'ipapi.is', 'cache'), call('d', 'ipapi.is', 'timeout')]);
    // Two live calls, one failed. Cache hits must not dilute the failure rate.
    expect(p).toMatchObject({ calls: 4, ok: 1, cache: 2, timeout: 1, failureRate: 0.5 });
    expect(providerHealth([call('a', 'turnstile', 'unconfigured')])[0]?.failureRate).toBeNull();
  });

  it('excludes structurally unknowable signals from availability', () => {
    const o = overview([record('a'), record('b', { signalStatus: { 'network.asn': 'error', 'device.posture': 'not_measurable' } })]);
    expect(o.signalAvailability).toEqual([{ key: 'network.asn', label: 'Network operator', total: 2, usable: 1, rate: 0.5 }]);
  });

  it('keeps decision counts consistent with the total', () => {
    const o = overview([record('a'), record('b', { decision: 'CHALLENGE' }), record('c', { decision: 'DENY' }), record('d', { assurance: 'reduced' })]);
    expect(o.decisions.reduce((sum, d) => sum + d.count, 0)).toBe(o.total);
    expect(o.assurance.reduce((sum, d) => sum + d.count, 0)).toBe(o.total);
    expect(o.daily).toEqual([{ day: '2026-11-14', allow: 2, challenge: 1, deny: 1 }]);
  });

  it('flags a provider failure that was recorded as a full-assurance decision', () => {
    const bad = overview([record('a', { botStatus: 'provider_error' })], [call('a', 'turnstile', 'error')]);
    expect(bad.misclassifiedFailures).toBe(1);
    expect(bad.findings[0]).toMatchObject({ severity: 'action' });
    // Correctly marked reduced: not a misclassification.
    expect(overview([record('a', { botStatus: 'provider_error', assurance: 'reduced' })], [call('a', 'turnstile', 'error')]).misclassifiedFailures).toBe(0);
    // An optional provider failing while everything the policy needs is present is also fine.
    expect(overview([record('a')], [call('a', 'abuseipdb', 'error')]).misclassifiedFailures).toBe(0);
  });

  it('lists organizations but never internet providers or hosts', () => {
    const o = overview([record('a', { orgName: 'Example Corp', orgType: 'business' }), record('b', { orgName: 'Example Corp', orgType: 'business' }), record('c', { orgName: 'Example Broadband', orgType: 'isp' }), record('d', { orgName: 'Example Cloud', orgType: 'hosting' })]);
    expect(o.organizations.map((x) => [x.name, x.visits])).toEqual([['Example Corp', 2]]);
  });

  it('derives findings an operator can act on, and says so when there is nothing', () => {
    expect(deriveFindings(overview([])).map((f) => f.title)).toEqual(['No evaluations in this window']);
    expect(overview([record('a')], [call('a', 'ipapi.is', 'ok')]).findings).toEqual([expect.objectContaining({ severity: 'ok' })]);
    const reduced = overview(Array.from({ length: 10 }, (_, i) => record(`r${i}`, { assurance: 'reduced', botStatus: 'unconfigured' })), Array.from({ length: 10 }, (_, i) => call(`r${i}`, 'turnstile', 'unconfigured')));
    expect(reduced.findings.map((f) => f.title)).toEqual(expect.arrayContaining([expect.stringMatching(/reduced assurance/), 'turnstile is not configured']));
    const skewed = overview([...Array.from({ length: 10 }, (_, i) => record(`f${i}`, { browserFamily: 'Firefox', decision: i < 6 ? 'CHALLENGE' : 'ALLOW' })), ...Array.from({ length: 40 }, (_, i) => record(`c${i}`))]);
    expect(skewed.findings.some((f) => /Firefox is challenged or denied 60%/.test(f.title))).toBe(true);
  });
});
