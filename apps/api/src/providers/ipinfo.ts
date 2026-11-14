import { requestJson, TtlCache, type FetchLike } from '../http';
import type { DailyBudget } from './budget';
import { skipped, unconfigured, type ProviderCall } from './types';

/**
 * IPinfo: which network an address belongs to.
 *
 * Two plans are supported. Lite (free) returns ASN, AS name and country.
 * Core (paid) adds an AS type and privacy flags. Fields a plan does not
 * include come back as `null`, which downstream means "unknown".
 */

export interface IpIntel {
  asn: string | null;
  asName: string | null;
  asDomain: string | null;
  countryCode: string | null;
  country: string | null;
  /** Core only. */
  asType: string | null;
  isHosting: boolean | null;
  isAnonymous: boolean | null;
  isMobile: boolean | null;
}

const PURPOSE = 'Network ownership (ASN, operator, country)';
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export function parseIpinfo(plan: 'lite' | 'core', body: unknown): IpIntel {
  const root = obj(body);
  if (plan === 'lite') {
    return {
      asn: str(root.asn),
      asName: str(root.as_name),
      asDomain: str(root.as_domain),
      countryCode: str(root.country_code),
      country: str(root.country),
      asType: null,
      isHosting: null,
      isAnonymous: null,
      isMobile: null,
    };
  }
  const as = obj(root.as);
  const geo = obj(root.geo);
  return {
    asn: str(as.asn),
    asName: str(as.name),
    asDomain: str(as.domain),
    countryCode: str(geo.country_code),
    country: str(geo.country),
    asType: str(as.type),
    isHosting: bool(root.is_hosting),
    isAnonymous: bool(root.is_anonymous),
    isMobile: bool(root.is_mobile),
  };
}

export class IpinfoProvider {
  readonly name = 'ipinfo';
  private readonly cache: TtlCache<IpIntel>;

  constructor(
    private readonly options: { token?: string; plan: 'lite' | 'core'; fetch: FetchLike; timeoutMs: number; budget: DailyBudget; now?: () => number },
  ) {
    // Network ownership changes slowly; an hour keeps answers fresh without re-asking on every reload.
    this.cache = new TtlCache(60 * 60 * 1000, 5000, options.now);
  }

  get configured(): boolean {
    return Boolean(this.options.token);
  }

  async lookup(ip: string): Promise<ProviderCall<IpIntel>> {
    const { token, plan, fetch, timeoutMs, now } = this.options;
    if (!token) return unconfigured(this.name, PURPOSE, 'IPINFO_TOKEN is not set');

    const cached = this.cache.get(ip);
    if (cached) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: 'cache', latencyMs: 0, ageSeconds: cached.ageSeconds },
        data: cached.value,
      };
    }

    if (!this.options.budget.take()) return skipped(this.name, PURPOSE, 'daily request budget exhausted');

    const path = plan === 'lite' ? 'lite' : 'lookup';
    // Token in a header, not the URL, so it cannot end up in a log line.
    const outcome = await requestJson(
      fetch,
      `https://api.ipinfo.io/${path}/${encodeURIComponent(ip)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      { timeoutMs, retry: true, now },
    );
    if (!outcome.ok) {
      const detail =
        outcome.status === 401 || outcome.status === 403
          ? 'authentication rejected: check IPINFO_TOKEN'
          : outcome.status === 429
            ? 'rate limited by provider'
            : outcome.detail;
      return {
        result: { provider: this.name, purpose: PURPOSE, status: outcome.kind === 'timeout' ? 'timeout' : 'error', latencyMs: outcome.latencyMs, detail },
        data: null,
      };
    }
    const data = parseIpinfo(plan, outcome.body);
    // A 200 with no ASN happens for unrouted space. It is an answer ("no known network"), so it is cached.
    this.cache.set(ip, data);
    return {
      result: {
        provider: this.name,
        purpose: PURPOSE,
        status: 'ok',
        latencyMs: outcome.latencyMs,
        ageSeconds: 0,
        detail: data.asn ? undefined : 'provider returned no network for this address',
      },
      data,
    };
  }
}
