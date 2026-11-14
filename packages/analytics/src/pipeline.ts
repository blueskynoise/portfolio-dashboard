import {
  isoToDay,
  type CloudIssue,
  type DependencyIssue,
  type Finding,
  type IngestRun,
  type Model,
  type ModelQuality,
  type Ownership,
  type Severity,
  type SourceRef,
  type Sources,
} from './model';

/**
 * From source exports to one model of the estate.
 *
 * validate -> normalise -> correlate to an asset -> deduplicate across
 * sources -> attach ownership -> attach ticket history.
 *
 * Each step is a small pure function so it can be tested on its own, and
 * each one records what it could not do rather than dropping it silently.
 */

// ── Collection health ─────────────────────────────────────────────────

export type RunVerdict = 'accept' | 'quarantine' | 'failed';

/**
 * Should a collection run be believed?
 *
 * "Zero findings" has at least four explanations: the estate is clean, the
 * query is wrong, the integration is broken, or the API returned a partial
 * answer. Only one of them is good news, so a run far below what recent
 * runs returned is quarantined for a person to look at, and nothing is
 * closed on the strength of it.
 */
export function assessRun(received: number, recentMedian: number, httpOk: boolean): { verdict: RunVerdict; reason: string } {
  if (!httpOk) return { verdict: 'failed', reason: 'The source did not answer successfully. State is held at the last good sync.' };
  if (recentMedian >= 20 && received < recentMedian * 0.25) {
    return {
      verdict: 'quarantine',
      reason: `Received ${received} records where recent runs returned about ${recentMedian}. A drop this sharp is more likely a broken query or a partial response than a sudden clean-up.`,
    };
  }
  return { verdict: 'accept', reason: 'Volume is in line with recent runs.' };
}

/** Weeks in which a source's figures should be read with caution. */
export function unreliableWeeks(runs: readonly IngestRun[]): Map<number, string[]> {
  const weeks = new Map<number, string[]>();
  for (const run of runs) {
    if (run.status === 'ok' || run.status === 'backfilled') continue;
    const label = `${run.source.replace('_', ' ')}${run.account ? ` (${run.account})` : ''}: ${run.status.replace(/_/g, ' ')}`;
    weeks.set(run.week, [...(weeks.get(run.week) ?? []), label]);
  }
  return weeks;
}

// ── Normalisation ─────────────────────────────────────────────────────

export interface Normalised {
  ref: SourceRef;
  account: string;
  assetName: string;
  vulnId: string;
  severity: Severity;
  exploit: boolean | null;
  firstSeen: number;
  closed: number | null;
  reopened: number | null;
  previouslyClosed: number | null;
  open: boolean;
}

export type NormaliseResult = { ok: true; record: Normalised } | { ok: false; id: string; reason: string };

const CLOUD_SEVERITY: Record<string, Severity> = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

export function severityFromCvss(cvss: number): Severity {
  if (cvss >= 9) return 'critical';
  if (cvss >= 7) return 'high';
  if (cvss >= 4) return 'medium';
  return 'low';
}

const day = (iso: string | null): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : isoToDay(iso);
};

export function normaliseCloud(raw: CloudIssue): NormaliseResult {
  const severity = CLOUD_SEVERITY[raw.severity];
  const firstSeen = day(raw.firstDetectedAt);
  if (!raw.resource?.account || !raw.resource.name) return { ok: false, id: raw.id, reason: 'no resource' };
  if (!severity) return { ok: false, id: raw.id, reason: `unknown severity "${raw.severity}"` };
  if (firstSeen === null) return { ok: false, id: raw.id, reason: 'unreadable detection date' };
  return {
    ok: true,
    record: {
      ref: { source: 'cloud_scanner', id: raw.id },
      account: raw.resource.account,
      assetName: raw.resource.name.toLowerCase(),
      vulnId: raw.rule.toUpperCase(),
      severity,
      exploit: raw.hasExploit,
      firstSeen,
      closed: day(raw.resolvedAt),
      reopened: day(raw.reopenedAt),
      previouslyClosed: day(raw.previouslyResolvedAt),
      open: raw.status === 'OPEN',
    },
  };
}

export function normaliseDependency(raw: DependencyIssue): NormaliseResult {
  // "syn-corp/<account>.<ASSET-NAME>"
  const match = /^[^/]+\/([^.]+)\.(.+)$/.exec(raw.project ?? '');
  const firstSeen = day(raw.introduced);
  if (!match) return { ok: false, id: raw.issue_id, reason: `cannot read project "${raw.project}"` };
  if (typeof raw.cvss !== 'number' || raw.cvss < 0 || raw.cvss > 10) return { ok: false, id: raw.issue_id, reason: 'score out of range' };
  if (firstSeen === null) return { ok: false, id: raw.issue_id, reason: 'unreadable introduced date' };
  return {
    ok: true,
    record: {
      ref: { source: 'dependency_scanner', id: raw.issue_id },
      account: match[1] as string,
      assetName: (match[2] as string).toLowerCase(),
      vulnId: raw.advisory.toUpperCase(),
      severity: severityFromCvss(raw.cvss),
      exploit: null,
      firstSeen,
      closed: day(raw.fixed_on),
      reopened: day(raw.reopened_on),
      previouslyClosed: day(raw.previously_fixed_on),
      open: !raw.fixed,
    },
  };
}

// ── Deduplication across sources ──────────────────────────────────────

export interface Merged {
  key: string;
  account: string;
  assetName: string;
  vulnId: string;
  severity: Severity;
  exploit: boolean;
  sources: SourceRef[];
  firstSeen: number;
  closed: number | null;
  reopened: number | null;
  previouslyClosed: number | null;
  open: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const earliest = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));
const latest = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * Two scanners reporting the same vulnerability on the same asset is one
 * finding with two witnesses. Merging removes a redundant *record*; the
 * exposure it describes is exactly as real as before.
 *
 * Where the witnesses disagree, the cautious reading wins: first seen is
 * the earliest, severity the highest, and the finding stays open until
 * every source that reported it agrees it is closed.
 */
export function mergeBySameFinding(records: readonly Normalised[]): { merged: Merged[]; duplicates: number } {
  const byKey = new Map<string, Merged>();
  let duplicates = 0;
  for (const r of records) {
    const key = `${r.account}/${r.assetName}::${r.vulnId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, account: r.account, assetName: r.assetName, vulnId: r.vulnId, severity: r.severity, exploit: r.exploit ?? false, sources: [r.ref], firstSeen: r.firstSeen, closed: r.closed, reopened: r.reopened, previouslyClosed: r.previouslyClosed, open: r.open });
      continue;
    }
    duplicates++;
    existing.sources.push(r.ref);
    existing.firstSeen = Math.min(existing.firstSeen, r.firstSeen);
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[existing.severity]) existing.severity = r.severity;
    existing.exploit = existing.exploit || (r.exploit ?? false);
    // Still open if either source says so; closed only when both agree, at the later of their dates.
    existing.open = existing.open || r.open;
    existing.closed = existing.open ? null : latest(existing.closed, r.closed);
    existing.reopened = earliest(existing.reopened, r.reopened);
    existing.previouslyClosed = latest(existing.previouslyClosed, r.previouslyClosed);
  }
  return { merged: [...byKey.values()], duplicates };
}

// ── Ownership ─────────────────────────────────────────────────────────

export function resolveOwnership(
  serviceTag: string | undefined,
  catalog: ReadonlyMap<string, { owner: string | null; ownerCurrent: boolean; tier: 1 | 2 | 3 }>,
): { ownership: Ownership; team: string | null; tier: 1 | 2 | 3; service: string | null } {
  if (!serviceTag) return { ownership: 'unreconciled', team: null, tier: 3, service: null };
  const entry = catalog.get(serviceTag);
  // A tag pointing at a service the catalogue has never heard of is no better than no tag.
  if (!entry) return { ownership: 'unreconciled', team: null, tier: 3, service: null };
  if (!entry.owner) return { ownership: 'missing', team: null, tier: entry.tier, service: serviceTag };
  return { ownership: entry.ownerCurrent ? 'verified' : 'stale', team: entry.owner, tier: entry.tier, service: serviceTag };
}

// ── Assembly ──────────────────────────────────────────────────────────

export function buildModel(sources: Sources): Model {
  const rejected: ModelQuality['rejected'] = [];
  const normalised: Normalised[] = [];
  for (const raw of sources.cloudIssues) {
    const result = normaliseCloud(raw);
    if (result.ok) normalised.push(result.record);
    else rejected.push({ source: 'cloud_scanner', id: result.id, reason: result.reason });
  }
  for (const raw of sources.dependencyIssues) {
    const result = normaliseDependency(raw);
    if (result.ok) normalised.push(result.record);
    else rejected.push({ source: 'dependency_scanner', id: result.id, reason: result.reason });
  }
  const { merged, duplicates } = mergeBySameFinding(normalised);

  const catalog = new Map(sources.catalog.map((s) => [s.name, s]));
  const assets = new Map(sources.inventory.map((a) => [`${a.account}/${a.name}`, a]));
  const accounts = new Map(sources.accounts.map((a) => [a.name, a]));
  const ticketByIssue = new Map(sources.tickets.map((t) => [t.issueRef, t]));

  const findings: Finding[] = [];
  for (const m of merged) {
    const asset = assets.get(`${m.account}/${m.assetName}`);
    const account = accounts.get(m.account);
    if (!asset || !account) {
      // A finding on something the inventory does not know about cannot be placed, owned or prioritised.
      rejected.push({ source: m.sources[0]?.source ?? 'unknown', id: m.sources[0]?.id ?? m.key, reason: 'asset not found in inventory' });
      continue;
    }
    const owner = resolveOwnership(asset.tags.service, catalog);
    const ticket = m.sources.map((s) => ticketByIssue.get(s.id)).find((t) => t !== undefined);
    const accepted = ticket?.resolution === 'risk_accepted' && ticket.resolvedAt !== null;

    // Open periods. A scanner keeps reporting an accepted risk, so the ticket is what closes that one.
    const intervals: Finding['intervals'] = [];
    if (accepted) {
      intervals.push({ from: m.firstSeen, to: isoToDay(ticket.resolvedAt as string) });
    } else if (m.reopened !== null && m.previouslyClosed !== null) {
      intervals.push({ from: m.firstSeen, to: Math.min(m.previouslyClosed, m.reopened) }, { from: m.reopened, to: m.open ? null : m.closed });
    } else {
      intervals.push({ from: m.firstSeen, to: m.open ? null : m.closed });
    }

    // The ticket reaches someone who can act when it stops moving: the last assignment.
    const lastAssignment = ticket?.assignments[ticket.assignments.length - 1];
    findings.push({
      key: m.key,
      assetId: asset.id,
      assetName: asset.name,
      account: m.account,
      environment: account.environment,
      cohort: account.onboardedDay > 0 ? 'new' : 'stable',
      service: owner.service,
      tier: owner.tier,
      // After a re-route, the team that ended up with it is the effective owner.
      team: lastAssignment?.team ?? owner.team,
      ownership: owner.ownership,
      vulnId: m.vulnId,
      severity: m.severity,
      exploit: m.exploit,
      sources: m.sources,
      firstSeen: m.firstSeen,
      intervals,
      closedAs: accepted ? 'risk_accepted' : intervals[intervals.length - 1]?.to !== null ? 'remediated' : null,
      ticketKey: ticket?.key ?? null,
      routedBy: ticket?.routedBy ?? null,
      assignedDay: lastAssignment ? isoToDay(lastAssignment.at) : null,
      reassignments: ticket ? Math.max(0, ticket.assignments.length - 1) : 0,
    });
  }

  const unreconciledAssets = sources.inventory.filter((a) => resolveOwnership(a.tags.service, catalog).ownership === 'unreconciled').length;
  return {
    findings,
    sources,
    quality: {
      recordsIn: { cloud: sources.cloudIssues.length, dependency: sources.dependencyIssues.length },
      rejected,
      duplicatesMerged: duplicates,
      unreconciledAssets,
      assetsTotal: sources.inventory.length,
    },
  };
}
