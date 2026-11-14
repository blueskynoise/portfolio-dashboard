/**
 * Configuration.
 *
 * Read once at boot and validated as a whole. In production a missing or
 * weak secret stops the process with every problem listed, rather than
 * limping along with an insecure default.
 */

export type ClientIpSource = 'socket' | 'x-real-ip' | 'x-forwarded-for';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  sessionSecret: string;
  ipHashSecret: string;
  sessionTtlMinutes: number;
  retentionDays: number;
  databaseUrl?: string;
  /** Which part of the request we believe about the client's address. */
  clientIpSource: ClientIpSource;
  /** For x-forwarded-for: how many trusted proxies sit in front of us. */
  forwardedHops: number;
  /** Canonical origin, used for Origin checks. Optional; falls back to the Host header. */
  publicOrigin?: string;
  turnstile: { siteKey?: string; secretKey?: string; hostname?: string };
  ipinfo: { token?: string; plan: 'lite' | 'core' };
  ipapiKey?: string;
  /** Hard ceiling on calls to each paid-or-metered provider per UTC day. */
  providerDailyLimit: number;
  abuseIpdbKey?: string;
  adminPasswordHash?: string;
  /** Third-party company-level visit analytics. Off unless a write key is set. */
  dreamdata: { writeKey?: string; cookieless: boolean };
  staticDir: string;
  providerTimeoutMs: number;
}

const DEV_SECRET = 'development-only-secret-do-not-use-in-production-0000';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const problems: string[] = [];
  const text = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = text(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  const sessionSecret = text('SESSION_SECRET') ?? (mode === 'production' ? '' : DEV_SECRET);
  if (mode === 'production') {
    if (sessionSecret.length < 32) problems.push('SESSION_SECRET must be set to at least 32 random characters');
    if (!text('DATABASE_URL')) problems.push('DATABASE_URL must be set: production does not run on the in-memory store');
  }
  const ipSource = text('CLIENT_IP_SOURCE') ?? (mode === 'production' ? 'x-real-ip' : 'socket');
  if (!['socket', 'x-real-ip', 'x-forwarded-for'].includes(ipSource)) {
    problems.push('CLIENT_IP_SOURCE must be socket, x-real-ip or x-forwarded-for');
  }
  const siteKey = text('TURNSTILE_SITE_KEY');
  const secretKey = text('TURNSTILE_SECRET_KEY');
  if (Boolean(siteKey) !== Boolean(secretKey)) {
    problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together');
  }
  const plan = text('IPINFO_PLAN') ?? 'lite';
  if (plan !== 'lite' && plan !== 'core') problems.push('IPINFO_PLAN must be lite or core');

  const dreamdataKey = text('DREAMDATA_WRITE_KEY');
  if (dreamdataKey && !/^[A-Za-z0-9-]{8,64}$/.test(dreamdataKey)) problems.push('DREAMDATA_WRITE_KEY does not look like a Dreamdata write key');
  const cookieless = text('DREAMDATA_COOKIELESS') ?? 'on';
  if (cookieless !== 'on' && cookieless !== 'off') problems.push('DREAMDATA_COOKIELESS must be on or off');

  const config: Config = {
    env: mode,
    port: integer('PORT', 8787, 1, 65535),
    sessionSecret,
    ipHashSecret: text('IP_HASH_SECRET') ?? `${sessionSecret}:ip`,
    sessionTtlMinutes: integer('SESSION_TTL_MINUTES', 480, 5, 1440),
    retentionDays: integer('RETENTION_DAYS', 30, 1, 365),
    databaseUrl: text('DATABASE_URL'),
    clientIpSource: ipSource as ClientIpSource,
    forwardedHops: integer('TRUSTED_PROXY_HOPS', 1, 1, 5),
    publicOrigin: text('PUBLIC_ORIGIN')?.replace(/\/$/, ''),
    turnstile: { siteKey, secretKey, hostname: text('TURNSTILE_HOSTNAME') },
    ipinfo: { token: text('IPINFO_TOKEN'), plan: plan as 'lite' | 'core' },
    ipapiKey: text('IPAPI_IS_KEY'),
    providerDailyLimit: integer('PROVIDER_DAILY_LIMIT', 900, 1, 1_000_000),
    abuseIpdbKey: text('ABUSEIPDB_API_KEY'),
    adminPasswordHash: text('ADMIN_PASSWORD_HASH'),
    dreamdata: { writeKey: dreamdataKey, cookieless: cookieless === 'on' },
    staticDir: text('STATIC_DIR') ?? 'apps/web/dist',
    providerTimeoutMs: integer('PROVIDER_TIMEOUT_MS', 2500, 200, 10000),
  };

  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}
