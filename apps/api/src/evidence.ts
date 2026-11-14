import type { ClientEvidence, CollectionMethod, ProviderResult, Reliability, Signal, SignalCategory, SignalKind, SignalStatus, SignalValue } from '@portfolio/contracts';
import { THRESHOLDS, type BotVerification, type PolicyFacts } from '@portfolio/policy';
import type { ResolvedIp } from './clientIp';
import type { AbuseReport } from './providers/abuseipdb';
import { KNOWN_HOSTING_ASNS } from './providers/hostingAsn';
import type { IpapiIntel } from './providers/ipapi';
import type { IpIntel } from './providers/ipinfo';
import type { BotCheck } from './providers/turnstile';
import type { ProviderCall } from './providers/types';
import { parseUserAgent, type ParsedUa } from './ua';

/**
 * Turning a request into evidence.
 *
 * Every signal is built here with its provenance attached: how it reached
 * us, what kind of statement it is, and how it can be wrong. The policy
 * facts are derived in the same place, so a signal the visitor is shown
 * and the fact the policy used can never drift apart.
 */

export interface RequestEvidence {
  ip: ResolvedIp;
  publicIp: boolean;
  tls: boolean;
  userAgent: string | undefined;
  acceptLanguage: string | undefined;
  clientHintBrands: string | undefined;
  clientHintPlatform: string | undefined;
  clientHintMobile: string | undefined;
  doNotTrack: string | undefined;
  globalPrivacyControl: string | undefined;
}

export interface SessionEvidence {
  continuity: 'new' | 'reassessment_of_active_session' | 'expired_or_invalid_session_presented';
  recentAssessments: number;
  recentChallengeFailures: number;
}

export interface Enrichment {
  ipapi: ProviderCall<IpapiIntel>;
  ipinfo: ProviderCall<IpIntel>;
  tor: ProviderCall<boolean>;
  abuse: ProviderCall<AbuseReport>;
}

export interface EvidenceBundle {
  signals: Signal[];
  facts: PolicyFacts;
  ua: ParsedUa;
  summary: {
    asn: string | null;
    asOrg: string | null;
    country: string | null;
    orgName: string | null;
    orgType: string | null;
    ipTimezone: string | null;
    maxEnrichmentAgeSeconds: number | null;
  };
}

interface SignalInit {
  value: SignalValue;
  status: SignalStatus;
  reliability: Reliability;
  source: string;
  method: CollectionMethod;
  kind: SignalKind;
  how?: string;
  note?: string;
  ageSeconds?: number;
}

export const signal = (key: string, label: string, category: SignalCategory, init: SignalInit): Signal => ({ key, label, category, ...init });

/** Status for a signal whose provider gave no usable data. */
function gapFrom(result: ProviderResult): Pick<SignalInit, 'value' | 'status' | 'reliability' | 'kind' | 'note'> {
  const status: SignalStatus = result.status === 'unconfigured' ? 'unconfigured' : result.status === 'skipped' ? 'unavailable' : 'error';
  return { value: null, status, reliability: 'none', kind: 'gap', note: `Unknown: ${result.detail ?? result.status}. Unknown is not the same as clear.` };
}

const strip = (value: string | undefined): string | undefined => value?.replace(/^"|"$/g, '');
const firstLanguage = (header: string | undefined): string | null => header?.split(',')[0]?.split(';')[0]?.trim().toLowerCase() || null;

/** Compare what the browser said about itself with what arrived on the wire. null = nothing comparable. */
export function checkConsistency(request: RequestEvidence, client: ClientEvidence | undefined): { consistent: boolean | null; mismatches: string[] } {
  if (!client) return { consistent: null, mismatches: [] };
  const mismatches: string[] = [];
  let compared = 0;
  if (client.userAgent !== undefined && request.userAgent !== undefined) {
    compared++;
    if (client.userAgent !== request.userAgent) mismatches.push('User-Agent reported by script differs from the request header');
  }
  if (client.uaData?.mobile !== undefined && request.clientHintMobile !== undefined) {
    compared++;
    if (client.uaData.mobile !== (request.clientHintMobile === '?1')) mismatches.push('"mobile" hint differs between script and request header');
  }
  if (client.uaData?.platform && request.clientHintPlatform) {
    compared++;
    if (client.uaData.platform !== strip(request.clientHintPlatform)) mismatches.push('Platform hint differs between script and request header');
  }
  return { consistent: compared === 0 ? null : mismatches.length === 0, mismatches };
}

export function buildEvidence(input: {
  request: RequestEvidence;
  client: ClientEvidence | undefined;
  enrichment: Enrichment;
  bot: ProviderCall<BotCheck>;
  session: SessionEvidence;
}): EvidenceBundle {
  const { request, client, enrichment, bot, session } = input;
  const { ipapi, ipinfo, tor, abuse } = enrichment;
  const signals: Signal[] = [];
  const add = (key: string, label: string, category: SignalCategory, init: SignalInit): void => void signals.push(signal(key, label, category, init));
  const ua = parseUserAgent(request.userAgent);
  const rich = ipapi.data;
  const basic = ipinfo.data;

  // ── Network: what the connection itself gives away ─────────────────
  add('network.ip', 'IP address', 'network', {
    value: request.ip.ip,
    status: request.ip.ip ? 'observed' : 'unavailable',
    reliability: request.ip.ip ? 'high' : 'none',
    source: 'connection',
    method: 'connection',
    kind: request.ip.ip ? 'fact' : 'gap',
    how: `Every connection has a source address. Established from: ${request.ip.method}.`,
    note: request.publicIp
      ? 'Identifies where the connection left the internet, not who made it. Behind a VPN, a corporate proxy or carrier NAT it is an exit shared with other people.'
      : 'A private or loopback address. There is no public network to look up.',
  });
  add('network.tls', 'Encrypted transport', 'network', {
    value: request.tls,
    status: 'observed',
    reliability: 'high',
    source: 'connection',
    method: 'connection',
    kind: 'fact',
    how: 'Reported by the edge that terminated the connection.',
  });

  const asn = rich?.asn ?? basic?.asn ?? null;
  const asOrg = rich?.asOrg ?? basic?.asName ?? null;
  const asnSource = rich?.asn ? ipapi.result : ipinfo.result;
  const disagree = Boolean(rich?.asn && basic?.asn && rich.asn !== basic.asn);
  add('network.asn', 'Network operator', 'network', asn
    ? {
        value: `${asn}${asOrg ? ` · ${asOrg}` : ''}`,
        status: 'enriched',
        reliability: disagree ? 'medium' : 'high',
        source: asnSource.provider,
        method: 'enrichment',
        kind: 'fact',
        ageSeconds: asnSource.ageSeconds,
        how: 'The address was looked up in routing data: which autonomous system announces it to the rest of the internet.',
        note: disagree
          ? `Two providers disagree: ipinfo says ${basic?.asn}. Routing data changes and providers update at different times.`
          : rich?.asn && basic?.asn
            ? 'Two independent providers agree. This is who carries the traffic, usually an ISP, mobile carrier or cloud.'
            : 'This is who carries the traffic, usually an ISP, mobile carrier or cloud.',
      }
    : { ...gapFrom(asnSource), source: asnSource.provider, method: 'enrichment' });

  const country = rich?.country ?? basic?.country ?? null;
  const place = rich ? [rich.city, rich.region, rich.country].filter(Boolean).join(', ') : country;
  add('network.location', 'Approximate location', 'network', place
    ? {
        value: place,
        status: 'enriched',
        reliability: rich?.city ? 'low' : 'medium',
        source: rich ? ipapi.result.provider : ipinfo.result.provider,
        method: 'enrichment',
        kind: 'inference',
        ageSeconds: (rich ? ipapi.result : ipinfo.result).ageSeconds,
        how: 'Inferred from where the address block is registered and routed. No location permission was requested or used.',
        note: `${rich?.locationAccuracy ? `Provider's own accuracy rating: ${rich.locationAccuracy.replace('_', ' ').toLowerCase()}. ` : ''}City-level IP geolocation is routinely wrong by a city or more, and a VPN moves it anywhere. Country is usually right.`,
      }
    : { ...gapFrom(ipapi.result), source: ipapi.result.provider, method: 'enrichment' });

  add('network.organisation', 'Organisation behind the address', 'identity', rich?.companyName
    ? {
        value: `${rich.companyName}${rich.companyDomain ? ` (${rich.companyDomain})` : ''}`,
        status: 'enriched',
        reliability: rich.companyType === 'business' || rich.companyType === 'education' || rich.companyType === 'government' || rich.companyType === 'banking' ? 'medium' : 'low',
        source: ipapi.result.provider,
        method: 'enrichment',
        kind: 'inference',
        ageSeconds: ipapi.result.ageSeconds,
        how: 'The most specific registration (WHOIS) record covering this address.',
        note:
          rich.companyType === 'isp'
            ? 'This is an internet provider, so it says which company sells you connectivity and nothing about where you work.'
            : rich.companyType === 'hosting'
              ? 'This is a hosting company. It usually means a VPN, proxy, cloud desktop or server, not an employer.'
              : 'If this names an organisation, the connection left through its network. That is a statement about a network. It does not identify you, and guests, contractors and VPN users all look the same.',
      }
    : { ...gapFrom(ipapi.result), source: ipapi.result.provider, method: 'enrichment' });

  const networkType = rich?.companyType ?? rich?.asType ?? basic?.asType ?? null;
  add('network.type', 'Network type', 'network', networkType
    ? {
        value: networkType,
        status: 'enriched',
        reliability: 'medium',
        source: rich ? ipapi.result.provider : ipinfo.result.provider,
        method: 'enrichment',
        kind: 'classification',
        how: 'A label the provider assigns to the owner of the address range: isp, hosting, business, education, government or banking.',
        note: 'A classification of the range owner. "business" is the provider\'s catch-all for everything else.',
      }
    : { ...gapFrom(ipapi.result), source: ipapi.result.provider, method: 'enrichment' });

  // Hosting: prefer a provider's classification; fall back to our own short list, which can only ever say "yes".
  let hosting: boolean | null = rich?.isDatacenter ?? basic?.isHosting ?? null;
  let hostingInit: SignalInit;
  if (hosting !== null) {
    hostingInit = {
      value: hosting ? (rich?.datacenterName ?? true) : false,
      status: 'enriched',
      reliability: 'medium',
      source: rich?.isDatacenter !== null && rich ? ipapi.result.provider : ipinfo.result.provider,
      method: 'enrichment',
      kind: 'classification',
      how: 'The provider matches the address against known datacentre and cloud ranges.',
      note: 'People do browse from hosting ranges: commercial VPNs, cloud desktops and corporate egress all live there.',
    };
  } else if (asn && KNOWN_HOSTING_ASNS.has(asn)) {
    hosting = true;
    hostingInit = {
      value: KNOWN_HOSTING_ASNS.get(asn) ?? true,
      status: 'derived',
      reliability: 'medium',
      source: 'first-party list',
      method: 'derived',
      kind: 'classification',
      how: 'The network operator is on our own short list of large hosting providers.',
      note: 'The list is deliberately small. Being on it is decent evidence; not being on it is evidence of nothing.',
    };
  } else {
    hostingInit = {
      value: null,
      status: 'unavailable',
      reliability: 'none',
      source: 'first-party list',
      method: 'derived',
      kind: 'gap',
      note: asn
        ? 'No provider classified this network, and it is not on our short list of hosting providers. That leaves it unknown, not residential.'
        : 'Unknown: there is no network information to classify.',
    };
  }
  add('network.hosting', 'Hosting or datacentre network', 'network', hostingInit);

  add('network.anonymiser', 'VPN or proxy', 'network', rich
    ? {
        value: rich.isVpn ? (rich.vpnService ?? 'VPN') : rich.isProxy ? 'proxy' : false,
        status: 'enriched',
        reliability: rich.isVpn || rich.isProxy ? 'medium' : 'low',
        source: ipapi.result.provider,
        method: 'enrichment',
        kind: 'classification',
        ageSeconds: ipapi.result.ageSeconds,
        how: 'The provider connects to commercial VPN services and records the exit addresses it sees.',
        note: 'A "no" is weak: the provider says residential and mobile proxies are mostly not detected, and new exits appear daily. Using a VPN is not held against you here.',
      }
    : { ...gapFrom(ipapi.result), source: ipapi.result.provider, method: 'enrichment' });

  const torCorroborated = tor.data !== null && rich?.isTor !== null && rich !== null && tor.data === rich.isTor;
  add('network.tor_exit', 'Tor exit relay', 'network', tor.data !== null
    ? {
        value: tor.data,
        status: 'enriched',
        reliability: 'high',
        source: tor.result.provider,
        method: 'enrichment',
        kind: 'fact',
        ageSeconds: tor.result.ageSeconds,
        how: 'Checked against the list of exit relays that the Tor Project itself publishes.',
        note: `${torCorroborated ? 'A second provider agrees. ' : ''}${tor.result.detail?.startsWith('list is stale') ? 'The list has not refreshed recently, so this answer is older than it should be. ' : ''}Tor use is noted and not penalised.`,
      }
    : { ...gapFrom(tor.result), source: tor.result.provider, method: 'enrichment' });

  add('network.abuse_confidence', 'Abuse reports for this address', 'network', abuse.data
    ? {
        value: abuse.data.confidence,
        status: 'enriched',
        reliability: 'medium',
        source: abuse.result.provider,
        method: 'enrichment',
        kind: 'classification',
        ageSeconds: abuse.result.ageSeconds,
        how: `Community-submitted reports about the address in the last 90 days (${abuse.data.totalReports} on file), expressed as a 0–100 confidence.`,
        note: `Reputation belongs to an address, and addresses are shared and reassigned. A score of ${THRESHOLDS.abuseConfidence}+ only ever triggers a bot check here.`,
      }
    : { ...gapFrom(abuse.result), source: abuse.result.provider, method: 'enrichment' });

  // ── Browser: what the request headers say ──────────────────────────
  add('browser.user_agent', 'User-Agent header', 'browser', {
    value: request.userAgent ?? null,
    status: request.userAgent ? 'observed' : 'unavailable',
    reliability: request.userAgent ? 'low' : 'none',
    source: 'request header',
    method: 'connection',
    kind: request.userAgent ? 'claim' : 'gap',
    how: 'Sent by the browser with every request, before any script runs.',
    note: 'A plain string the client chooses. Trivially changed, and frozen or reduced by several browsers.',
  });
  add('browser.identity', 'Browser and operating system', 'browser', {
    value: ua.family === 'none' ? null : `${ua.family}${ua.major ? ` ${ua.major}` : ''} on ${ua.os}`,
    status: ua.family === 'none' ? 'unavailable' : 'derived',
    reliability: ua.family === 'none' || ua.family === 'unknown' ? 'none' : 'low',
    source: 'request header',
    method: 'derived',
    kind: ua.family === 'none' ? 'gap' : 'inference',
    how: 'Parsed from the User-Agent header.',
    note: 'Only as trustworthy as the header it was read from.',
  });
  add('browser.client_hints', 'Client hints', 'browser', {
    value: request.clientHintBrands ? `${request.clientHintBrands.replace(/;v="/g, ' ').replace(/"/g, '')}${request.clientHintPlatform ? ` · ${strip(request.clientHintPlatform)}` : ''}` : null,
    status: request.clientHintBrands ? 'observed' : 'unavailable',
    reliability: request.clientHintBrands ? 'low' : 'none',
    source: 'request header',
    method: 'connection',
    kind: request.clientHintBrands ? 'claim' : 'gap',
    how: 'Sec-CH-UA headers, which Chromium browsers attach to requests by default.',
    note: request.clientHintBrands ? 'Sent without being asked for. Client-controlled, like the User-Agent.' : 'Not sent. Firefox and Safari do not implement these headers, so their absence means little.',
  });
  add('browser.languages', 'Language preferences', 'browser', {
    value: request.acceptLanguage ?? null,
    status: request.acceptLanguage ? 'observed' : 'unavailable',
    reliability: request.acceptLanguage ? 'medium' : 'none',
    source: 'request header',
    method: 'connection',
    kind: request.acceptLanguage ? 'claim' : 'gap',
    how: 'The Accept-Language header: the languages your browser asks for, in order of preference.',
    note: 'Rarely spoofed because changing it breaks sites. An ordered list of several languages is surprisingly distinctive, and it often says more about nationality than the IP address does.',
  });
  const privacyFlags = [request.globalPrivacyControl === '1' ? 'Global Privacy Control: on' : null, request.doNotTrack === '1' ? 'Do Not Track: on' : null].filter(Boolean);
  add('browser.privacy_signals', 'Privacy preference headers', 'browser', {
    value: privacyFlags.length > 0 ? privacyFlags.join(' · ') : 'none sent',
    status: 'observed',
    reliability: 'medium',
    source: 'request header',
    method: 'connection',
    kind: 'fact',
    how: 'The Sec-GPC and DNT request headers.',
    note: 'Sending these is itself a distinguishing trait: asking not to be tracked makes a browser slightly easier to tell apart.',
  });

  // ── Browser: what the page script reported ─────────────────────────
  const claimed = (value: SignalValue | undefined, how: string, note: string): SignalInit =>
    value === undefined
      ? { value: null, status: 'unavailable', reliability: 'none', source: 'browser script', method: 'script', kind: 'gap', how, note: 'The browser did not report this.' }
      : { value, status: 'claimed', reliability: 'low', source: 'browser script', method: 'script', kind: 'claim', how, note };
  add('browser.secure_context', 'Secure context', 'browser', claimed(client?.secureContext, 'window.isSecureContext, read by the page.', 'Self-reported by the page script.'));
  add('browser.cookies', 'Cookies enabled', 'browser', claimed(client?.cookiesEnabled, 'navigator.cookieEnabled, read by the page.', 'Self-reported. Whether the session cookie actually comes back is the real test.'));
  const caps = client?.capabilities;
  add(
    'browser.capabilities',
    'Security capabilities',
    'browser',
    claimed(
      caps ? [caps.webCrypto ? 'WebCrypto' : null, caps.webAuthn ? 'WebAuthn' : null, caps.serviceWorker ? 'Service Worker' : null].filter(Boolean).join(', ') || 'none reported' : undefined,
      'Feature detection by the page script.',
      'Shows what the browser could do, for example passkeys. It says nothing about whether any of it is in use.',
    ),
  );

  const consistency = checkConsistency(request, client);
  add('browser.consistency', 'Script versus request', 'browser', {
    value: consistency.consistent === null ? null : consistency.consistent ? 'consistent' : consistency.mismatches.join('; '),
    status: consistency.consistent === null ? 'unavailable' : 'derived',
    reliability: consistency.consistent === null ? 'none' : 'medium',
    source: 'server comparison',
    method: 'derived',
    kind: consistency.consistent === null ? 'gap' : 'inference',
    how: 'What the page script reported is compared with the headers that arrived on the same connection.',
    note: 'A mismatch means something rewrote one or the other: a privacy extension, an automation tool, or someone editing the request.',
  });

  // ── Automation ─────────────────────────────────────────────────────
  const botOutcome: BotVerification = bot.data?.outcome ?? 'provider_error';
  const botDescriptions: Record<BotVerification, [SignalStatus, Reliability, string]> = {
    passed: ['enriched', 'high', 'The provider validated the token, server to server.'],
    failed: ['enriched', 'high', `The provider rejected the token${bot.data?.errorCodes.length ? ` (${bot.data.errorCodes.join(', ')})` : ''}.`],
    missing: ['unavailable', 'none', 'No token was presented, so nothing was verified.'],
    unconfigured: ['unconfigured', 'none', 'Bot verification has no credentials on this deployment. Automation was not assessed, which is not the same as passing.'],
    provider_error: ['error', 'none', 'The provider could not be reached. Automation was not assessed, which is not the same as passing.'],
  };
  const [botStatus, botReliability, botNote] = botDescriptions[botOutcome];
  add('automation.bot_verification', 'Bot verification', 'automation', {
    value: botOutcome,
    status: botStatus,
    reliability: botReliability,
    source: bot.result.provider,
    method: 'enrichment',
    kind: botOutcome === 'passed' || botOutcome === 'failed' ? 'classification' : 'gap',
    how: 'The page obtains a token from Cloudflare Turnstile; our server then asks Cloudflare whether that token is genuine.',
    note: botNote,
  });
  add('automation.webdriver', 'Automation flag', 'automation', claimed(client?.webdriver, 'navigator.webdriver, which browsers set when driven by automation tooling.', 'Self-reported and easy to hide, so "false" proves nothing. "true" is worth a question.'));

  // ── Session ────────────────────────────────────────────────────────
  const continuityText: Record<SessionEvidence['continuity'], string> = {
    new: 'No session cookie presented',
    reassessment_of_active_session: 'An active session was already present',
    expired_or_invalid_session_presented: 'A session cookie was presented but is no longer valid',
  };
  add('session.continuity', 'Session continuity', 'session', {
    value: continuityText[session.continuity],
    status: 'observed',
    reliability: 'high',
    source: 'first-party cookie',
    method: 'connection',
    kind: 'fact',
    how: 'Whether this request carried a session cookie that we issued and signed.',
    note: 'A cookie links visits from one browser profile. Clearing cookies or opening a private window starts again.',
  });
  add('session.request_rate', 'Recent evaluations from this address', 'session', {
    value: session.recentAssessments,
    status: 'observed',
    reliability: 'high',
    source: 'first-party counter',
    method: 'derived',
    kind: 'fact',
    how: `Counted on our side, keyed on a hash of the address, over the last ${THRESHOLDS.rateWindowMinutes} minutes.`,
    note: 'Counts everyone behind the same address, so a busy office or a VPN exit shares one number.',
  });
  add('session.challenge_failures', 'Recent failed bot checks from this address', 'session', {
    value: session.recentChallengeFailures,
    status: 'observed',
    reliability: 'high',
    source: 'first-party counter',
    method: 'derived',
    kind: 'fact',
    how: `Counted on our side over the last ${THRESHOLDS.rateWindowMinutes} minutes.`,
  });

  // ── What this cannot know ──────────────────────────────────────────
  add('identity.person', 'Who you are', 'identity', {
    value: null,
    status: 'not_measurable',
    reliability: 'none',
    source: 'none',
    method: 'none',
    kind: 'gap',
    note: 'Nobody signed in, so nothing here identifies a person. Everything above describes a connection and a browser. Commercial "identity resolution" services claim to go further by matching visits against purchased data; none is used here.',
  });
  add('device.posture', 'Device security posture', 'device', {
    value: null,
    status: 'not_measurable',
    reliability: 'none',
    source: 'none',
    method: 'none',
    kind: 'gap',
    note: 'Disk encryption, endpoint protection, patch level and whether the device is managed cannot be read by a public website. Establishing them takes device management or hardware attestation, which this site does not have.',
  });

  const ages = [ipapi.result, ipinfo.result, tor.result, abuse.result]
    .filter((r) => (r.status === 'ok' || r.status === 'cache') && r.ageSeconds !== undefined)
    .map((r) => r.ageSeconds as number);

  return {
    signals,
    ua,
    facts: {
      bot: botOutcome,
      recentAssessments: session.recentAssessments,
      recentChallengeFailures: session.recentChallengeFailures,
      torExit: tor.data ?? rich?.isTor ?? null,
      hostingNetwork: hosting,
      abuseConfidence: abuse.data?.confidence ?? null,
      webdriver: client?.webdriver ?? null,
      clientConsistent: consistency.consistent,
      networkContextAvailable: asn !== null,
    },
    summary: {
      asn,
      asOrg,
      country: rich?.countryCode ?? basic?.countryCode ?? null,
      orgName: rich?.companyName ?? null,
      orgType: rich?.companyType ?? null,
      ipTimezone: rich?.timezone ?? null,
      maxEnrichmentAgeSeconds: ages.length > 0 ? Math.max(...ages) : null,
    },
  };
}

export { firstLanguage };
