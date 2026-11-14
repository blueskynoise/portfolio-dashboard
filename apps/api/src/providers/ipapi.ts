import { requestJson, TtlCache, type FetchLike } from '../http';
import type { DailyBudget } from './budget';
import { skipped, unconfigured, type ProviderCall } from './types';

/**
 * ipapi.is: who operates an address range and what kind of network it is.
 *
 * This is the richest enrichment source: the organization in the WHOIS
 * record, the network type, a coarse location, and flags for datacenters,
 * VPNs, proxies and Tor.
 *
 * Its own documentation calls the data probabilistic. "company" is the
 * most specific WHOIS record for the range, which for a home connection is
 * the ISP and for an office is, at best, whoever registered the block.
 */

export interface IpapiIntel {
  asn: string | null;
  asOrg: string | null;
  asType: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyType: string | null;
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  locationAccuracy: string | null;
  isDatacenter: boolean | null;
  datacenterName: string | null;
  isVpn: boolean | null;
  vpnService: string | null;
  isProxy: boolean | null;
  isTor: boolean | null;
  isMobile: boolean | null;
  isAbuser: boolean | null;
  isCrawler: string | null;
}

const PURPOSE = 'Organization, network type, location, anonymizer flags';
const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' ? (value as Record<string, unknown>) : null);

export function parseIpapi(body: unknown): IpapiIntel | null {
  const root = obj(body);
  // Every real answer echoes the address and carries the detection flags. Without them this is not an answer.
  if (!root || typeof root.ip !== 'string' || typeof root.is_datacenter !== 'boolean') return null;
  const asn = obj(root.asn);
  const company = obj(root.company);
  const location = obj(root.location);
  const vpn = obj(root.vpn);
  const datacenter = obj(root.datacenter);
  return {
    asn: typeof asn?.asn === 'number' ? `AS${asn.asn}` : null,
    asOrg: str(asn?.org),
    asType: str(asn?.type),
    companyName: str(company?.name),
    companyDomain: str(company?.domain),
    companyType: str(company?.type),
    countryCode: str(location?.country_code),
    country: str(location?.country),
    region: str(location?.state),
    city: str(location?.city),
    timezone: str(location?.timezone),
    locationAccuracy: str(location?.accuracy),
    isDatacenter: bool(root.is_datacenter),
    datacenterName: str(datacenter?.datacenter),
    // The provider documents that is_vpn can be set without a vpn object, and advises testing truthiness.
    isVpn: root.is_vpn === undefined ? null : Boolean(root.is_vpn),
    vpnService: str(vpn?.service),
    isProxy: bool(root.is_proxy),
    isTor: bool(root.is_tor),
    isMobile: bool(root.is_mobile),
    isAbuser: bool(root.is_abuser),
    isCrawler: typeof root.is_crawler === 'string' ? root.is_crawler : null,
  };
}

export class IpapiProvider {
  readonly name = 'ipapi.is';
  private readonly cache: TtlCache<IpapiIntel>;

  constructor(
    private readonly options: { apiKey?: string; fetch: FetchLike; timeoutMs: number; budget: DailyBudget; now?: () => number },
  ) {
    this.cache = new TtlCache(6 * 60 * 60 * 1000, 5000, options.now);
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async lookup(ip: string): Promise<ProviderCall<IpapiIntel>> {
    const { apiKey, fetch, timeoutMs, budget, now } = this.options;
    if (!apiKey) return unconfigured(this.name, PURPOSE, 'IPAPI_IS_KEY is not set');

    const cached = this.cache.get(ip);
    if (cached) {
      return { result: { provider: this.name, purpose: PURPOSE, status: 'cache', latencyMs: 0, ageSeconds: cached.ageSeconds }, data: cached.value };
    }
    if (!budget.take()) return skipped(this.name, PURPOSE, 'daily request budget exhausted');

    // POST keeps the key out of the URL, and so out of any proxy or access log.
    const outcome = await requestJson(
      fetch,
      'https://api.ipapi.is/',
      { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ q: ip, key: apiKey }) },
      { timeoutMs, now },
    );
    if (!outcome.ok) {
      const detail =
        outcome.status === 403 ? 'key rejected: check IPAPI_IS_KEY' : outcome.status === 429 ? 'provider quota exceeded' : outcome.detail;
      return { result: { provider: this.name, purpose: PURPOSE, status: outcome.kind === 'timeout' ? 'timeout' : 'error', latencyMs: outcome.latencyMs, detail }, data: null };
    }
    const data = parseIpapi(outcome.body);
    if (!data) {
      return { result: { provider: this.name, purpose: PURPOSE, status: 'error', latencyMs: outcome.latencyMs, detail: 'unexpected response shape' }, data: null };
    }
    this.cache.set(ip, data);
    return { result: { provider: this.name, purpose: PURPOSE, status: 'ok', latencyMs: outcome.latencyMs, ageSeconds: 0 }, data };
  }
}
