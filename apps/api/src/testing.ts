import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from './admin/auth';
import { buildApp } from './app';
import type { Config } from './config';
import type { FetchLike } from './http';
import { AbuseIpdbProvider } from './providers/abuseipdb';
import { DailyBudget } from './providers/budget';
import { IpapiProvider } from './providers/ipapi';
import { IpinfoProvider } from './providers/ipinfo';
import { TOR_LIST_URL, TorExitList } from './providers/tor';
import { TurnstileProvider } from './providers/turnstile';
import type { StaticSite } from './static';
import { MemoryStore } from './store/memory';

/** Test harness: the real app, wired to an in-memory store and scripted providers. Never used in production code. */

export const VISITOR_IP = '203.0.113.7';
export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const ADMIN_PASSWORD = 'correct horse battery staple';

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const ipapiBody = (overrides: Record<string, unknown> = {}) => ({
  ip: VISITOR_IP,
  is_datacenter: false,
  is_tor: false,
  is_proxy: false,
  is_vpn: false,
  is_abuser: false,
  is_mobile: false,
  is_crawler: false,
  company: { name: 'Example Broadband', domain: 'example-isp.test', type: 'isp' },
  asn: { asn: 64500, org: 'Example Broadband', type: 'isp' },
  location: { country: 'United States', country_code: 'US', state: 'Ohio', city: 'Columbus', timezone: 'America/New_York', accuracy: 'HIGH' },
  ...overrides,
});

export interface World {
  ipapi: Responder;
  ipinfo: Responder;
  abuse: Responder;
  turnstile: Responder;
  tor: Responder;
  calls: string[];
}

export function defaultWorld(): World {
  return {
    ipapi: () => json(ipapiBody()),
    ipinfo: () => json({ ip: VISITOR_IP, asn: 'AS64500', as_name: 'Example Broadband', as_domain: 'example-isp.test', country_code: 'US', country: 'United States' }),
    abuse: () => json({ data: { abuseConfidenceScore: 0, totalReports: 0, lastReportedAt: null, usageType: 'Fixed Line ISP' } }),
    turnstile: () => json({ success: true, action: 'gate', hostname: 'localhost', 'error-codes': [] }),
    tor: () => new Response(Array.from({ length: 150 }, (_, i) => `198.51.100.${i}`).join('\n')),
    calls: [],
  };
}

export interface Harness {
  app: FastifyInstance;
  store: MemoryStore;
  world: World;
  clock: { now: number };
  site: StaticSite;
  tor: TorExitList;
}

export interface HarnessOptions {
  configured?: Partial<Record<'ipapi' | 'ipinfo' | 'abuse' | 'turnstile' | 'admin', boolean>>;
  config?: Partial<Config>;
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const on = { ipapi: true, ipinfo: true, abuse: true, turnstile: true, admin: true, ...options.configured };
  const world = defaultWorld();
  const clock = { now: Date.UTC(2026, 10, 14, 12, 0, 0) };
  const now = () => clock.now;
  const fetchImpl: FetchLike = async (url, init) => {
    world.calls.push(url);
    const pick = url.includes('ipapi.is') ? world.ipapi : url.includes('ipinfo.io') ? world.ipinfo : url.includes('abuseipdb') ? world.abuse : url.includes('turnstile') ? world.turnstile : url === TOR_LIST_URL ? world.tor : null;
    if (!pick) throw new Error(`unexpected outbound request to ${url}`);
    // Honor the abort signal the way real fetch does, so timeouts can be tested.
    return await Promise.race([
      Promise.resolve(pick(url, init)),
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ]);
  };

  const config: Config = {
    env: 'test',
    port: 0,
    sessionSecret: 'test-session-secret-0123456789abcdef-0123456789',
    ipHashSecret: 'test-ip-secret',
    sessionTtlMinutes: 60,
    retentionDays: 30,
    clientIpSource: 'x-real-ip',
    forwardedHops: 1,
    turnstile: on.turnstile ? { siteKey: 'site-key', secretKey: 'secret-key' } : {},
    ipinfo: { token: on.ipinfo ? 'ipinfo-token' : undefined, plan: 'lite' },
    ipapiKey: on.ipapi ? 'ipapi-key' : undefined,
    providerDailyLimit: 1000,
    abuseIpdbKey: on.abuse ? 'abuse-key' : undefined,
    adminPasswordHash: on.admin ? hashPassword(ADMIN_PASSWORD) : undefined,
    staticDir: '',
    providerTimeoutMs: 80,
    ...options.config,
  };

  const dir = mkdtempSync(join(tmpdir(), 'portfolio-test-'));
  const write = (name: string, content: string): string => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };
  const site: StaticSite = {
    files: new Map([
      ['/static/gate-abc.js', write('gate.js', 'console.log("gate")')],
      ['/static/app-def.js', write('app.js', 'console.log("the portfolio")')],
      ['/assets/bivvi-logo.png', write('logo.png', 'png')],
      ['/assets/favicon.svg', write('favicon.svg', '<svg/>')],
    ]),
    publicPaths: new Set(['/static/gate-abc.js', '/assets/favicon.svg']),
    gateHtml: '<!doctype html><title>gate</title>',
    appHtml: '<!doctype html><title>portfolio</title>',
  };

  const store = new MemoryStore();
  const tor = new TorExitList({ fetch: fetchImpl, timeoutMs: 80, now });
  await tor.refresh();
  const budget = () => new DailyBudget(config.providerDailyLimit, now);
  const app = await buildApp({
    config,
    store,
    site,
    now,
    logger: false,
    providers: {
      ipapi: new IpapiProvider({ apiKey: config.ipapiKey, fetch: fetchImpl, timeoutMs: config.providerTimeoutMs, budget: budget(), now }),
      ipinfo: new IpinfoProvider({ token: config.ipinfo.token, plan: 'lite', fetch: fetchImpl, timeoutMs: config.providerTimeoutMs, budget: budget(), now }),
      abuse: new AbuseIpdbProvider({ apiKey: config.abuseIpdbKey, fetch: fetchImpl, timeoutMs: config.providerTimeoutMs, budget: budget(), now }),
      turnstile: new TurnstileProvider({ ...config.turnstile, fetch: fetchImpl, timeoutMs: config.providerTimeoutMs, now }),
      tor,
    },
  });
  world.calls.length = 0;
  return { app, store, world, clock, site, tor };
}

export interface Visit {
  ip?: string;
  ua?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

export const requestHeaders = (visit: Visit = {}): Record<string, string> => ({
  'x-real-ip': visit.ip ?? VISITOR_IP,
  'x-forwarded-proto': 'https',
  'user-agent': visit.ua ?? CHROME_UA,
  'accept-language': 'en-US,en;q=0.9',
  host: 'portfolio.test',
  ...(visit.cookies ? { cookie: Object.entries(visit.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
  ...visit.headers,
});

/** Run an assessment the way the gate page does. */
export async function assess(h: Harness, visit: Visit = {}, body: Record<string, unknown> = {}) {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/assessments',
    headers: requestHeaders(visit),
    payload: { botToken: 'valid-token', client: { userAgent: visit.ua ?? CHROME_UA, secureContext: true, cookiesEnabled: true, webdriver: false }, ...body },
  });
  const cookies = Object.fromEntries(response.cookies.map((c) => [c.name, c.value]));
  return { response, body: response.json(), cookies, sessionCookie: response.cookies.find((c) => c.name === 'pd_session') };
}

export { json };
