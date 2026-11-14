import type { AssessmentReport, AssessmentRequest, ProviderResult, SignalStatus, StageTiming } from '@portfolio/contracts';
import { evaluatePolicy, THRESHOLDS } from '@portfolio/policy';
import { hmacIp, truncateIp } from './clientIp';
import { buildEvidence, type Enrichment, type RequestEvidence, type SessionEvidence } from './evidence';
import type { AbuseIpdbProvider } from './providers/abuseipdb';
import type { IpapiProvider } from './providers/ipapi';
import type { IpinfoProvider } from './providers/ipinfo';
import type { TorExitList } from './providers/tor';
import type { TurnstileProvider } from './providers/turnstile';
import { skipped, type ProviderCall } from './providers/types';
import type { SlidingCounter } from './rateLimit';
import { newId } from './sessions';
import type { AssessmentRecord, ProviderCallRecord } from './store/types';

export interface Providers {
  ipapi: IpapiProvider;
  ipinfo: IpinfoProvider;
  tor: TorExitList;
  abuse: AbuseIpdbProvider;
  turnstile: TurnstileProvider;
}

export interface AssessmentInput {
  requestId: string;
  request: RequestEvidence;
  body: AssessmentRequest;
  continuity: SessionEvidence['continuity'];
}

export interface AssessmentResult {
  /** What the visitor is shown now, including their full address. */
  live: AssessmentReport;
  /** What is kept. */
  record: AssessmentRecord;
  calls: ProviderCallRecord[];
}

export const LIMITATIONS = [
  'This is a passive evaluation of a connection and a browser. It is not a device health check: nothing here knows whether your disk is encrypted, your system is patched or your machine is managed.',
  'Enrichment comes from third parties and is evidence with an error rate, not ground truth. Each signal says how it can be wrong.',
  'Anything the browser reports about itself can be forged. Signals from the page script are labelled as claims and weighted accordingly.',
  'This is a public portfolio. Nothing confidential sits behind the gate; it exists to show how such a gate is built, and it is enforced by the server all the same.',
];

const notRequested = (why: string): Enrichment => ({
  ipapi: skipped('ipapi.is', 'Organisation, network type, location, anonymiser flags', why),
  ipinfo: skipped('ipinfo', 'Network ownership (ASN, operator, country)', why),
  tor: skipped('torproject', 'Tor exit relay membership', why),
  abuse: skipped('abuseipdb', 'Address abuse reputation', why),
});
const elapsed = (start: number): number => Math.max(0, Math.round(performance.now() - start));
const worst = (results: ProviderResult[]): StageTiming['status'] =>
  results.some((r) => r.status === 'error' || r.status === 'timeout') ? 'failed' : results.some((r) => r.status === 'unconfigured' || r.status === 'skipped') ? 'degraded' : 'ok';

/** Replace the values we do not keep. The report structure stays identical. */
export function redactReport(report: AssessmentReport, ipPrefix: string | null, browserLabel: string): AssessmentReport {
  return {
    ...report,
    signals: report.signals.map((s) => {
      if (s.key === 'network.ip' && s.value !== null) return { ...s, value: ipPrefix, note: `${s.note ?? ''} Stored truncated; the full address is only ever shown live to the connection it belongs to.`.trim() };
      if (s.key === 'browser.user_agent' && s.value !== null) return { ...s, value: browserLabel, note: `${s.note ?? ''} The full header is not stored.`.trim() };
      return s;
    }),
  };
}

export async function runAssessment(
  deps: { providers: Providers; counters: { assessments: SlidingCounter; challengeFailures: SlidingCounter }; ipHashSecret: string; now: () => number },
  input: AssessmentInput,
): Promise<AssessmentResult> {
  const { providers, counters } = deps;
  const { request, body } = input;
  const started = performance.now();
  const createdAt = new Date(deps.now());
  const stages: StageTiming[] = [];
  const ip = request.ip.ip;
  const ipKey = ip ? hmacIp(ip, deps.ipHashSecret) : null;

  // ── Stage: session context (first-party counters only) ─────────────
  let t = performance.now();
  const recentAssessments = ipKey ? counters.assessments.hit(ipKey) : 1;
  const flooding = recentAssessments > THRESHOLDS.assessmentsPerWindow;
  stages.push({ stage: 'session', label: 'Session and rate context', status: 'ok', ms: elapsed(t), detail: `${recentAssessments} evaluation${recentAssessments === 1 ? '' : 's'} from this address in ${THRESHOLDS.rateWindowMinutes} min` });

  // ── Stage: network enrichment ──────────────────────────────────────
  t = performance.now();
  let enrichment: Enrichment;
  if (flooding) {
    // Do not spend provider quota on a client that is already over the limit.
    enrichment = notRequested('not requested: this address is over the evaluation rate limit');
  } else if (!ip || !request.publicIp) {
    enrichment = notRequested(ip ? 'not requested: private or loopback address' : 'not requested: no client address could be established');
  } else {
    // In parallel: the slowest provider sets the cost, not the sum of them.
    const [ipapi, ipinfo, abuse] = await Promise.all([providers.ipapi.lookup(ip), providers.ipinfo.lookup(ip), providers.abuse.check(ip)]);
    enrichment = { ipapi, ipinfo, abuse, tor: providers.tor.check(ip) };
  }
  const enrichmentResults = [enrichment.ipapi.result, enrichment.ipinfo.result, enrichment.tor.result, enrichment.abuse.result];
  const answered = enrichmentResults.filter((r) => r.status === 'ok' || r.status === 'cache').length;
  stages.push({
    stage: 'network',
    label: 'Network context',
    status: answered === 0 ? 'failed' : worst(enrichmentResults),
    ms: elapsed(t),
    detail: `${answered} of ${enrichmentResults.length} sources answered`,
  });

  // ── Stage: bot verification ────────────────────────────────────────
  t = performance.now();
  const bot: ProviderCall<{ outcome: 'passed' | 'failed' | 'missing' | 'unconfigured' | 'provider_error'; errorCodes: string[] }> = flooding
    ? { result: { provider: 'turnstile', purpose: 'Bot verification', status: 'skipped', latencyMs: 0, detail: 'not requested: over the evaluation rate limit' }, data: { outcome: 'missing', errorCodes: [] } }
    : await providers.turnstile.verify(body.botToken, ip);
  if (bot.data?.outcome === 'failed' && ipKey) counters.challengeFailures.hit(ipKey);
  stages.push({
    stage: 'automation',
    label: 'Bot verification',
    status: bot.data?.outcome === 'passed' ? 'ok' : bot.data?.outcome === 'failed' || bot.data?.outcome === 'missing' ? 'degraded' : 'failed',
    ms: elapsed(t),
    detail: bot.result.detail ?? bot.data?.outcome ?? 'unknown',
  });

  // ── Stage: browser evidence ────────────────────────────────────────
  t = performance.now();
  const evidence = buildEvidence({
    request,
    client: body.client,
    enrichment,
    bot,
    session: { continuity: input.continuity, recentAssessments, recentChallengeFailures: ipKey ? counters.challengeFailures.count(ipKey) : 0 },
  });
  stages.push({
    stage: 'browser',
    label: 'Browser evidence',
    status: body.client ? 'ok' : 'degraded',
    ms: elapsed(t),
    detail: body.client ? `${evidence.signals.filter((s) => s.category === 'browser' && s.kind !== 'gap').length} browser signals read` : 'no script evidence submitted; request headers only',
  });

  // ── Stage: policy ──────────────────────────────────────────────────
  t = performance.now();
  const outcome = evaluatePolicy(evidence.facts);
  stages.push({ stage: 'policy', label: 'Policy evaluation', status: 'ok', ms: elapsed(t), detail: `policy ${outcome.version}: ${outcome.rules.filter((r) => r.outcome === 'matched').length} of ${outcome.rules.length} rules matched` });

  const id = newId();
  const providersUsed = [...enrichmentResults, bot.result];
  const live: AssessmentReport = {
    id,
    requestId: input.requestId,
    createdAt: createdAt.toISOString(),
    policyVersion: outcome.version,
    decision: outcome.decision,
    assurance: outcome.assurance,
    explanation: outcome.explanation,
    reasons: outcome.reasons,
    rules: outcome.rules,
    signals: evidence.signals,
    providers: providersUsed,
    stages,
    limitations: LIMITATIONS,
    totalMs: elapsed(started),
  };

  const ipPrefix = ip ? truncateIp(ip) : null;
  const browserLabel = `${evidence.ua.family}${evidence.ua.major ? ` ${evidence.ua.major}` : ''} on ${evidence.ua.os}`;
  const signalStatus: Record<string, SignalStatus> = Object.fromEntries(evidence.signals.map((s) => [s.key, s.status]));

  return {
    live,
    calls: providersUsed.map((r) => ({
      assessmentId: id,
      createdAt,
      provider: r.provider,
      status: r.status,
      latencyMs: r.latencyMs,
      ageSeconds: r.ageSeconds ?? null,
      detail: r.detail ?? null,
    })),
    record: {
      id,
      requestId: input.requestId,
      createdAt,
      policyVersion: outcome.version,
      decision: outcome.decision,
      assurance: outcome.assurance,
      reasonCodes: outcome.reasons.map((r) => r.code),
      report: redactReport(live, ipPrefix, browserLabel),
      ipHmac: ipKey,
      ipPrefix,
      asn: evidence.summary.asn,
      asOrg: evidence.summary.asOrg,
      country: evidence.summary.country,
      browserFamily: evidence.ua.family,
      browserMajor: evidence.ua.major,
      osFamily: evidence.ua.os,
      botStatus: evidence.facts.bot,
      sessionContinuity: input.continuity,
      totalMs: live.totalMs,
      signalStatus,
      orgName: evidence.summary.orgName,
      orgType: evidence.summary.orgType,
      maxEnrichmentAgeSeconds: evidence.summary.maxEnrichmentAgeSeconds,
    },
  };
}
