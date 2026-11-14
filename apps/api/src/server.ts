import { POLICY_DOCUMENT } from '@portfolio/policy';
import { buildApp } from './app';
import { loadConfig } from './config';
import { AbuseIpdbProvider } from './providers/abuseipdb';
import { DailyBudget } from './providers/budget';
import { IpapiProvider } from './providers/ipapi';
import { IpinfoProvider } from './providers/ipinfo';
import { TorExitList } from './providers/tor';
import { TurnstileProvider } from './providers/turnstile';
import { runRetention } from './retention';
import { loadStaticSite } from './static';
import { MemoryStore } from './store/memory';
import { PgStore } from './store/pg';
import type { Store } from './store/types';

async function main(): Promise<void> {
  const config = loadConfig();
  const fetchImpl = (url: string, init?: RequestInit) => fetch(url, init);
  const timeoutMs = config.providerTimeoutMs;

  const store: Store = config.databaseUrl ? new PgStore(config.databaseUrl) : new MemoryStore();
  const tor = new TorExitList({ fetch: fetchImpl, timeoutMs: 10_000 });
  const providers = {
    ipapi: new IpapiProvider({ apiKey: config.ipapiKey, fetch: fetchImpl, timeoutMs, budget: new DailyBudget(config.providerDailyLimit) }),
    ipinfo: new IpinfoProvider({ token: config.ipinfo.token, plan: config.ipinfo.plan, fetch: fetchImpl, timeoutMs, budget: new DailyBudget(config.providerDailyLimit) }),
    abuse: new AbuseIpdbProvider({ apiKey: config.abuseIpdbKey, fetch: fetchImpl, timeoutMs, budget: new DailyBudget(config.providerDailyLimit) }),
    turnstile: new TurnstileProvider({ siteKey: config.turnstile.siteKey, secretKey: config.turnstile.secretKey, expectedHostname: config.turnstile.hostname, fetch: fetchImpl, timeoutMs: Math.max(timeoutMs, 4000) }),
    tor,
  };
  const site = loadStaticSite(config.staticDir);
  const app = await buildApp({ config, store, providers, site });

  if (store.kind === 'memory') app.log.warn('no DATABASE_URL: using the in-memory store. Nothing will survive a restart.');
  if (!site) app.log.warn({ staticDir: config.staticDir }, 'no built web app found: serving the API only. Run "npm run build" for the full site.');
  for (const [name, configured] of Object.entries({ turnstile: providers.turnstile.configured, 'ipapi.is': providers.ipapi.configured, ipinfo: providers.ipinfo.configured, abuseipdb: providers.abuse.configured })) {
    if (!configured) app.log.warn({ provider: name }, 'provider not configured: its signals will be reported as unknown');
  }

  await store.ping();
  await store.recordPolicyVersion(POLICY_DOCUMENT);
  tor.start();
  const retention = () => void runRetention(store, config.retentionDays, Date.now(), (message, data) => app.log.info(data, message));
  retention();
  const retentionTimer = setInterval(retention, 60 * 60 * 1000);
  retentionTimer.unref();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(retentionTimer);
    tor.stop();
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  // Configuration and startup failures are printed plainly and exit non-zero so the platform does not route traffic here.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
