import type { AdminOverview, Distribution, HealthFinding, LatencySummary, ProviderHealth, PublicHealth, SignalStatus } from '@portfolio/contracts';
import { TOR_STALE_AFTER_SECONDS } from '../providers/tor';
import type { AssessmentRecord, EventRecord, FingerprintRecord, InvestigationRecord, ProviderCallRecord } from '../store/types';

/**
 * Operational analytics for the access gateway.
 *
 * The question is not "how many visitors" but "is the evaluation doing its
 * job": are signals arriving, are providers reliable, are decisions being
 * made on stale or missing evidence, and is any failure being counted as a
 * pass. Pure functions over stored rows, so every number is testable.
 */

const USABLE: ReadonlySet<SignalStatus> = new Set(['observed', 'derived', 'enriched', 'claimed']);
/** Signals that are structurally unknowable are not availability problems. */
const STRUCTURAL: ReadonlySet<SignalStatus> = new Set(['not_measurable', 'not_consented']);

export function distribution<T>(items: readonly T[], key: (item: T) => string): Distribution[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Nearest-rank percentile. Returns 0 for an empty set. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] as number;
}

export const latencySummary = (values: readonly number[]): LatencySummary => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: values.length > 0 ? Math.max(...values) : 0,
});

export function providerHealth(calls: readonly ProviderCallRecord[]): ProviderHealth[] {
  const byProvider = new Map<string, ProviderCallRecord[]>();
  for (const call of calls) byProvider.set(call.provider, [...(byProvider.get(call.provider) ?? []), call]);
  return [...byProvider].map(([provider, list]) => {
    const count = (status: string): number => list.filter((c) => c.status === status).length;
    const ok = count('ok');
    const failed = count('timeout') + count('error');
    // Only calls that actually went out count towards reliability. Cache hits and "unconfigured" never touched the provider.
    const attempted = ok + failed;
    const ages = list.map((c) => c.ageSeconds).filter((age): age is number => age !== null);
    return {
      provider,
      calls: list.length,
      ok,
      cache: count('cache'),
      timeout: count('timeout'),
      error: count('error'),
      unconfigured: count('unconfigured'),
      skipped: count('skipped'),
      failureRate: attempted === 0 ? null : failed / attempted,
      latency: latencySummary(list.filter((c) => c.status === 'ok' || c.status === 'timeout' || c.status === 'error').map((c) => c.latencyMs)),
      maxAgeSeconds: ages.length > 0 ? Math.max(...ages) : null,
    };
  }).sort((a, b) => a.provider.localeCompare(b.provider));
}

export interface OverviewInput {
  assessments: readonly AssessmentRecord[];
  calls: readonly ProviderCallRecord[];
  events: readonly EventRecord[];
  investigations: readonly InvestigationRecord[];
  fingerprints: readonly FingerprintRecord[];
  now: Date;
  windowDays: number;
}

export function computeOverview(input: OverviewInput): AdminOverview {
  const { assessments, calls, events, investigations, fingerprints } = input;
  const total = assessments.length;
  const failedCallsByAssessment = new Set(calls.filter((c) => c.status === 'error' || c.status === 'timeout').map((c) => c.assessmentId));

  const days = new Map<string, { day: string; allow: number; challenge: number; deny: number }>();
  for (const a of assessments) {
    const day = a.createdAt.toISOString().slice(0, 10);
    const row = days.get(day) ?? { day, allow: 0, challenge: 0, deny: 0 };
    if (a.decision === 'ALLOW') row.allow++;
    else if (a.decision === 'CHALLENGE') row.challenge++;
    else row.deny++;
    days.set(day, row);
  }

  // Signal availability: of the assessments where a signal could have been known, how often was it?
  const labels = new Map<string, string>();
  const availability = new Map<string, { total: number; usable: number }>();
  for (const a of assessments) {
    for (const s of a.report.signals) labels.set(s.key, s.label);
    for (const [key, status] of Object.entries(a.signalStatus)) {
      if (STRUCTURAL.has(status)) continue;
      const row = availability.get(key) ?? { total: 0, usable: 0 };
      row.total++;
      if (USABLE.has(status)) row.usable++;
      availability.set(key, row);
    }
  }
  const signalAvailability = [...availability]
    .map(([key, row]) => ({ key, label: labels.get(key) ?? key, total: row.total, usable: row.usable, rate: row.total === 0 ? 0 : row.usable / row.total }))
    .sort((a, b) => a.rate - b.rate || a.key.localeCompare(b.key));

  const browsers = new Map<string, { total: number; nonAllow: number }>();
  for (const a of assessments) {
    const row = browsers.get(a.browserFamily) ?? { total: 0, nonAllow: 0 };
    row.total++;
    if (a.decision !== 'ALLOW') row.nonAllow++;
    browsers.set(a.browserFamily, row);
  }
  const browserImpact = [...browsers]
    .map(([browser, row]) => ({ browser, total: row.total, nonAllow: row.nonAllow, rate: row.nonAllow / row.total }))
    .sort((a, b) => b.total - a.total);

  // The invariant: a decision made while a provider was failing must never carry standard assurance
  // unless the policy had everything it needed anyway (bot verification passed and network context present).
  const misclassifiedFailures = assessments.filter(
    (a) => a.decision === 'ALLOW' && a.assurance === 'standard' && (a.botStatus !== 'passed' || a.asn === null) && failedCallsByAssessment.has(a.id),
  ).length;
  const staleEnrichmentDecisions = assessments.filter((a) => (a.maxEnrichmentAgeSeconds ?? 0) > TOR_STALE_AFTER_SECONDS).length;

  const organizations = new Map<string, { name: string; type: string; visits: number; lastSeen: string }>();
  for (const a of assessments) {
    // Internet providers and hosts are not "who visited"; only ranges registered to an organization are listed.
    if (!a.orgName || a.orgType === 'isp' || a.orgType === 'hosting') continue;
    const row = organizations.get(a.orgName) ?? { name: a.orgName, type: a.orgType ?? 'unknown', visits: 0, lastSeen: a.createdAt.toISOString() };
    row.visits++;
    if (a.createdAt.toISOString() > row.lastSeen) row.lastSeen = a.createdAt.toISOString();
    organizations.set(a.orgName, row);
  }

  const providers = providerHealth(calls);
  const admitted = assessments.filter((a) => a.decision === 'ALLOW').length;
  const overview: AdminOverview = {
    generatedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    total,
    decisions: distribution(assessments, (a) => a.decision),
    assurance: distribution(assessments, (a) => a.assurance),
    daily: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    botOutcomes: distribution(assessments, (a) => a.botStatus),
    policyVersions: distribution(assessments, (a) => a.policyVersion),
    sessionContinuity: distribution(assessments, (a) => a.sessionContinuity),
    latency: latencySummary(assessments.map((a) => a.totalMs)),
    providers,
    signalAvailability,
    browserImpact,
    events: distribution(events, (e) => e.type),
    misclassifiedFailures,
    staleEnrichmentDecisions,
    investigations: { open: investigations.filter((i) => i.status === 'open').length, total: investigations.length },
    fingerprintOptIn: { admitted, optedIn: fingerprints.length },
    recognition: distribution(fingerprints, (f) => f.recognition),
    organizations: [...organizations.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)).slice(0, 50),
    findings: [],
  };
  overview.findings = deriveFindings(overview);
  return overview;
}

/** Turn the numbers into the handful of things an operator should actually look at. */
export function deriveFindings(o: AdminOverview): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const pct = (value: number): string => `${Math.round(value * 100)}%`;
  if (o.total === 0) {
    return [{ severity: 'watch', title: 'No evaluations in this window', detail: 'There is nothing to assess yet. Every other number on this page is empty rather than good.' }];
  }

  if (o.misclassifiedFailures > 0) {
    findings.push({ severity: 'action', title: 'Provider failures recorded as standard-assurance decisions', detail: `${o.misclassifiedFailures} decision${o.misclassifiedFailures === 1 ? '' : 's'}. This should be impossible; treat it as a bug in the policy or the evidence builder.` });
  }
  const reduced = o.assurance.find((d) => d.key === 'reduced')?.count ?? 0;
  if (reduced / o.total > 0.2) {
    findings.push({ severity: 'action', title: `${pct(reduced / o.total)} of decisions were made with reduced assurance`, detail: 'The policy is regularly deciding without evidence it expects. Check which providers are unconfigured or failing below.' });
  }
  for (const p of o.providers) {
    if (p.unconfigured === p.calls && p.calls > 0) {
      findings.push({ severity: 'watch', title: `${p.provider} is not configured`, detail: 'Every signal it would supply is being recorded as unknown.' });
    } else if (p.failureRate !== null && p.failureRate > 0.05 && p.ok + p.timeout + p.error >= 5) {
      findings.push({ severity: p.failureRate > 0.25 ? 'action' : 'watch', title: `${p.provider} failed ${pct(p.failureRate)} of live calls`, detail: `${p.timeout} timeouts and ${p.error} errors across ${p.ok + p.timeout + p.error} calls. p95 latency ${p.latency.p95} ms.` });
    }
  }
  if (o.staleEnrichmentDecisions > 0) {
    findings.push({ severity: 'watch', title: `${o.staleEnrichmentDecisions} decision${o.staleEnrichmentDecisions === 1 ? ' was' : 's were'} made on stale enrichment data`, detail: 'A cached source was older than its refresh interval allows. The Tor exit list failing to refresh is the usual cause.' });
  }
  const nonAllow = o.total - (o.decisions.find((d) => d.key === 'ALLOW')?.count ?? 0);
  const overallRate = nonAllow / o.total;
  for (const b of o.browserImpact) {
    // Flag only with enough volume to mean something, and only when clearly above the overall rate.
    if (b.total >= 10 && b.rate > Math.max(0.25, overallRate * 2)) {
      findings.push({ severity: 'watch', title: `${b.browser} is challenged or denied ${pct(b.rate)} of the time`, detail: `Against ${pct(overallRate)} overall (${b.nonAllow} of ${b.total}). Worth checking whether a rule is penalizing the browser rather than the behavior.` });
    }
  }
  const weakest = o.signalAvailability.find((s) => s.total >= 5 && s.rate < 0.5);
  if (weakest) {
    findings.push({ severity: 'watch', title: `"${weakest.label}" is usable in only ${pct(weakest.rate)} of evaluations`, detail: 'A rule that depends on it is mostly not being evaluated.' });
  }
  if (o.policyVersions.length > 1) {
    findings.push({ severity: 'watch', title: `${o.policyVersions.length} policy versions in this window`, detail: 'Outcome rates before and after a policy change are not directly comparable. Compare them per version.' });
  }
  if (o.investigations.open > 0) {
    findings.push({ severity: 'watch', title: `${o.investigations.open} decision${o.investigations.open === 1 ? '' : 's'} under investigation as a possible false positive`, detail: 'Flagged by an administrator and not yet closed.' });
  }
  if (findings.length === 0) {
    findings.push({ severity: 'ok', title: 'Nothing needs attention', detail: 'Providers are answering, signals are arriving and no decision was made on missing evidence without being marked as such.' });
  }
  return findings;
}

export const PUBLIC_MIN_EVALUATIONS = 10;

/**
 * Reduce the private overview to what is safe to publish.
 *
 * Provider state says nothing about any visitor, so it is always included.
 * Everything derived from evaluations is withheld below the minimum.
 */
export function publicHealth(overview: AdminOverview, policyVersion: string, configured: Readonly<Record<string, boolean>>): PublicHealth {
  const sufficient = overview.total >= PUBLIC_MIN_EVALUATIONS;
  const share = (key: string, list: Distribution[]): number => Math.round(((list.find((d) => d.key === key)?.count ?? 0) / overview.total) * 100);
  const byName = new Map(overview.providers.map((p) => [p.provider, p]));
  return {
    generatedAt: overview.generatedAt,
    windowDays: overview.windowDays,
    policyVersion,
    sufficient,
    minimumToPublish: PUBLIC_MIN_EVALUATIONS,
    evaluations: sufficient ? Math.floor(overview.total / 10) * 10 : null,
    decisions: sufficient ? { allow: share('ALLOW', overview.decisions), challenge: share('CHALLENGE', overview.decisions), deny: share('DENY', overview.decisions) } : null,
    standardAssurance: sufficient ? share('standard', overview.assurance) : null,
    latency: sufficient ? { p50: overview.latency.p50, p95: overview.latency.p95 } : null,
    failuresCountedAsPasses: sufficient ? overview.misclassifiedFailures : null,
    providers: Object.entries(configured).map(([name, isConfigured]) => {
      const health = byName.get(name);
      const state: PublicHealth['providers'][number]['state'] = !isConfigured
        ? 'not_configured'
        : !health || health.ok + health.cache + health.timeout + health.error === 0
          ? 'no_live_calls'
          : (health.failureRate ?? 0) > 0.05
            ? 'degraded'
            : // Answering from a fresh cache or a periodically refreshed list counts as working.
              'healthy';
      return { name, state };
    }),
  };
}
