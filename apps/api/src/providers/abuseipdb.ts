import { requestJson, TtlCache, type FetchLike } from '../http';
import type { DailyBudget } from './budget';
import { skipped, unconfigured, type ProviderCall } from './types';

/**
 * AbuseIPDB: community abuse reports about an address.
 *
 * Optional. The free plan allows 1,000 checks a day, so answers are cached
 * for six hours. Reputation describes an address, and addresses are shared
 * and reassigned, so the policy only ever uses this to ask for bot
 * verification.
 */

export interface AbuseReport {
  confidence: number;
  totalReports: number;
  lastReportedAt: string | null;
  usageType: string | null;
}

const PURPOSE = 'Address abuse reputation';

export function parseAbuseIpdb(body: unknown): AbuseReport | null {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data.abuseConfidenceScore !== 'number') return null;
  return {
    confidence: data.abuseConfidenceScore,
    totalReports: typeof data.totalReports === 'number' ? data.totalReports : 0,
    lastReportedAt: typeof data.lastReportedAt === 'string' ? data.lastReportedAt : null,
    usageType: typeof data.usageType === 'string' ? data.usageType : null,
  };
}

export class AbuseIpdbProvider {
  readonly name = 'abuseipdb';
  private readonly cache: TtlCache<AbuseReport>;

  constructor(private readonly options: { apiKey?: string; fetch: FetchLike; timeoutMs: number; budget: DailyBudget; now?: () => number }) {
    this.cache = new TtlCache(6 * 60 * 60 * 1000, 5000, options.now);
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async check(ip: string): Promise<ProviderCall<AbuseReport>> {
    const { apiKey, fetch, timeoutMs, now } = this.options;
    if (!apiKey) return unconfigured(this.name, PURPOSE, 'ABUSEIPDB_API_KEY is not set');

    const cached = this.cache.get(ip);
    if (cached) {
      return { result: { provider: this.name, purpose: PURPOSE, status: 'cache', latencyMs: 0, ageSeconds: cached.ageSeconds }, data: cached.value };
    }
    if (!this.options.budget.take()) return skipped(this.name, PURPOSE, 'daily request budget exhausted');
    const outcome = await requestJson(
      fetch,
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
      { headers: { key: apiKey, accept: 'application/json' } },
      { timeoutMs, now },
    );
    if (!outcome.ok) {
      const detail = outcome.status === 429 ? 'daily quota exhausted' : outcome.status === 401 ? 'authentication rejected: check ABUSEIPDB_API_KEY' : outcome.detail;
      return { result: { provider: this.name, purpose: PURPOSE, status: outcome.kind === 'timeout' ? 'timeout' : 'error', latencyMs: outcome.latencyMs, detail }, data: null };
    }
    const data = parseAbuseIpdb(outcome.body);
    if (!data) {
      // A 200 we cannot read is a failure, not a clean reputation.
      return { result: { provider: this.name, purpose: PURPOSE, status: 'error', latencyMs: outcome.latencyMs, detail: 'unexpected response shape' }, data: null };
    }
    this.cache.set(ip, data);
    return { result: { provider: this.name, purpose: PURPOSE, status: 'ok', latencyMs: outcome.latencyMs, ageSeconds: 0 }, data };
  }
}
