import { CURRENT, END_DAY, PREVIOUS, SLA_DAYS, type Cohort, type Environment, type Finding, type Model, type Ownership, type Severity } from './model';
import { unreliableWeeks } from './pipeline';

/**
 * Measurements.
 *
 * Three families that must not be confused:
 *   posture        how much exposure exists (backlog, aging)
 *   effectiveness  how well the program works it (throughput, time to assign, SLA)
 *   reliability    how far the data can be trusted (coverage, freshness, reconciliation)
 *
 * Every rate states its denominator, and every comparison between
 * quarters uses the same definition on both sides.
 */

export type SeverityFilter = 'critical' | 'critical_high' | 'all';

export interface View {
  severity: SeverityFilter;
  /** all = everything scanned today; stable = accounts scanned throughout; new = accounts onboarded this quarter. */
  cohort: 'all' | Cohort;
  team: string | null;
  environment: Environment | null;
  tier: 1 | 2 | 3 | null;
  ownership: Ownership | null;
}

export const DEFAULT_VIEW: View = { severity: 'critical', cohort: 'all', team: null, environment: null, tier: null, ownership: null };

const SEVERITIES: Record<SeverityFilter, readonly Severity[]> = { critical: ['critical'], critical_high: ['critical', 'high'], all: ['critical', 'high', 'medium', 'low'] };

export function matches(f: Finding, view: View): boolean {
  if (!SEVERITIES[view.severity].includes(f.severity)) return false;
  if (view.cohort !== 'all' && f.cohort !== view.cohort) return false;
  if (view.team !== null && f.team !== view.team) return false;
  if (view.environment !== null && f.environment !== view.environment) return false;
  if (view.tier !== null && f.tier !== view.tier) return false;
  if (view.ownership !== null && f.ownership !== view.ownership) return false;
  return true;
}

/** Open at the end of `day`. An interval covers [from, to). */
export const openAt = (f: Finding, day: number): boolean => f.intervals.some((i) => i.from <= day && (i.to === null || i.to > day));

/** Age in days of the currently open period, or null if not open. */
export function ageAt(f: Finding, day: number): number | null {
  const interval = f.intervals.find((i) => i.from <= day && (i.to === null || i.to > day));
  // Age runs from first detection, not from a reopen: the exposure is as old as the vulnerability.
  return interval ? day - f.firstSeen : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const inWindow = (day: number | null, from: number, to: number): boolean => day !== null && day > from && day <= to;
const rate = (numerator: number, denominator: number): number | null => (denominator === 0 ? null : numerator / denominator);

export interface Flow {
  start: number;
  /** First detections in accounts that were only brought into scanning during the window. */
  discoveredInNewScope: number;
  /** First detections in accounts that were already being scanned. */
  newInExistingScope: number;
  reopened: number;
  remediated: number;
  riskAccepted: number;
  end: number;
}

/** Account for every change in the backlog between two days. start + inflows - outflows = end, exactly. */
export function flow(findings: readonly Finding[], from: number, to: number): Flow {
  const result: Flow = { start: 0, discoveredInNewScope: 0, newInExistingScope: 0, reopened: 0, remediated: 0, riskAccepted: 0, end: 0 };
  for (const f of findings) {
    if (openAt(f, from)) result.start++;
    if (openAt(f, to)) result.end++;
    f.intervals.forEach((interval, index) => {
      if (inWindow(interval.from, from, to)) {
        if (index > 0) result.reopened++;
        else if (f.cohort === 'new') result.discoveredInNewScope++;
        else result.newInExistingScope++;
      }
      if (inWindow(interval.to, from, to)) {
        const last = index === f.intervals.length - 1;
        if (last && f.closedAs === 'risk_accepted') result.riskAccepted++;
        else result.remediated++;
      }
    });
  }
  return result;
}

export interface AssignmentStats {
  detected: number;
  /** Reached a team within a week. Denominator: findings detected at least 7 days before the window ended. */
  eligible: number;
  assignedWithinWeek: number;
  withinWeekRate: number | null;
  /** Median days from detection to assignment, among those assigned by the end of the window. */
  medianDays: number | null;
  /** Detected in the window and still with no team at its end. Not in the median: they have no assignment date yet. */
  unassigned: number;
}

export function assignment(findings: readonly Finding[], from: number, to: number): AssignmentStats {
  const detected = findings.filter((f) => inWindow(f.firstSeen, from, to));
  const eligible = detected.filter((f) => f.firstSeen <= to - 7);
  const assignedByEnd = detected.filter((f) => f.assignedDay !== null && f.assignedDay <= to);
  const withinWeek = eligible.filter((f) => f.assignedDay !== null && f.assignedDay - f.firstSeen <= 7).length;
  return {
    detected: detected.length,
    eligible: eligible.length,
    assignedWithinWeek: withinWeek,
    withinWeekRate: rate(withinWeek, eligible.length),
    medianDays: median(assignedByEnd.map((f) => Math.max(0, (f.assignedDay as number) - f.firstSeen))),
    unassigned: detected.length - assignedByEnd.length,
  };
}

export interface SlaStats {
  /** Findings whose deadline fell inside the window. */
  due: number;
  met: number;
  rate: number | null;
}

/** Of the findings that came due in the window, how many were fixed by their deadline? */
export function sla(findings: readonly Finding[], from: number, to: number): SlaStats {
  let due = 0;
  let met = 0;
  for (const f of findings) {
    const deadline = f.firstSeen + SLA_DAYS[f.severity];
    if (!inWindow(deadline, from, to)) continue;
    due++;
    const firstClose = f.intervals[0]?.to ?? null;
    // Accepting a risk is not meeting the deadline; it is a different, documented outcome.
    const acceptedOnly = f.intervals.length === 1 && f.closedAs === 'risk_accepted';
    if (firstClose !== null && firstClose <= deadline && !acceptedOnly) met++;
  }
  return { due, met, rate: rate(met, due) };
}

export const AGE_BUCKETS = [
  { label: '0–14 days', max: 14 },
  { label: '15–30', max: 30 },
  { label: '31–60', max: 60 },
  { label: '61–90', max: 90 },
  { label: 'Over 90', max: Infinity },
] as const;

export interface OwnershipRow {
  ownership: Ownership;
  open: number;
  /** Share of all open findings in this view. */
  openShare: number | null;
  overSla: number;
  /** Share of this group's open findings that are past deadline. */
  overSlaRate: number | null;
  medianAgeDays: number | null;
  unassigned: number;
}

export interface TeamRow {
  team: string;
  open: number;
  overSla: number;
  overSlaRate: number | null;
  medianAgeDays: number | null;
  /** Fixed during the window. */
  remediated: number;
  /** Tickets created in the window that were re-routed at least once. */
  reassignedRate: number | null;
}

export interface WeekPoint {
  week: number;
  open: number;
  openStable: number;
  openNew: number;
  detected: number;
  remediated: number;
  /** Collection problems that week; figures are reconstructed, not observed. */
  caveats: string[];
}

export interface Analysis {
  view: View;
  matched: number;
  current: Flow;
  previous: Flow;
  /** Change in backlog over the current quarter, as a fraction of where it started. */
  backlogChange: number | null;
  /** The same accounting restricted to accounts scanned throughout. */
  stable: { current: Flow; backlogChange: number | null };
  throughput: { previous: number; current: number; change: number | null };
  assignment: { previous: AssignmentStats; current: AssignmentStats };
  sla: { previous: SlaStats; current: SlaStats };
  aging: { label: string; count: number; overSla: number }[];
  overSla: { count: number; open: number };
  ownership: OwnershipRow[];
  teams: TeamRow[];
  routing: Record<'automation' | 'manual', { tickets: number; reassigned: number; reassignedRate: number | null; medianDaysToAssign: number | null }>;
  series: WeekPoint[];
  accepted: { open: number };
  oldest: Finding[];
}

export function analyze(model: Model, view: View = DEFAULT_VIEW): Analysis {
  const findings = model.findings.filter((f) => matches(f, view));
  const current = flow(findings, CURRENT.from, CURRENT.to);
  const previous = flow(findings, PREVIOUS.from, PREVIOUS.to);
  const stableFindings = findings.filter((f) => f.cohort === 'stable');
  const stableFlow = flow(stableFindings, CURRENT.from, CURRENT.to);
  const change = (f: Flow): number | null => (f.start === 0 ? null : (f.end - f.start) / f.start);

  const open = findings.filter((f) => openAt(f, END_DAY));
  const isOverSla = (f: Finding): boolean => (ageAt(f, END_DAY) ?? 0) > SLA_DAYS[f.severity];
  const ages = (list: readonly Finding[]): number[] => list.map((f) => ageAt(f, END_DAY) as number);

  const aging = AGE_BUCKETS.map((bucket, index) => {
    const min = index === 0 ? -Infinity : (AGE_BUCKETS[index - 1] as (typeof AGE_BUCKETS)[number]).max;
    const inBucket = open.filter((f) => {
      const age = ageAt(f, END_DAY) as number;
      return age > min && age <= bucket.max;
    });
    return { label: bucket.label, count: inBucket.length, overSla: inBucket.filter(isOverSla).length };
  });

  const ownership: OwnershipRow[] = (['verified', 'stale', 'missing', 'unreconciled'] as const).map((status) => {
    const group = open.filter((f) => f.ownership === status);
    const over = group.filter(isOverSla).length;
    return {
      ownership: status,
      open: group.length,
      openShare: rate(group.length, open.length),
      overSla: over,
      overSlaRate: rate(over, group.length),
      medianAgeDays: median(ages(group)),
      unassigned: group.filter((f) => f.assignedDay === null || f.assignedDay > END_DAY).length,
    };
  });

  const teamNames = [...new Set(findings.map((f) => f.team).filter((t): t is string => t !== null))].sort();
  const teams: TeamRow[] = teamNames.map((team) => {
    const mine = findings.filter((f) => f.team === team);
    const mineOpen = mine.filter((f) => openAt(f, END_DAY));
    const over = mineOpen.filter(isOverSla).length;
    const ticketed = mine.filter((f) => f.ticketKey !== null && inWindow(f.firstSeen, CURRENT.from, CURRENT.to));
    return {
      team,
      open: mineOpen.length,
      overSla: over,
      overSlaRate: rate(over, mineOpen.length),
      medianAgeDays: median(ages(mineOpen)),
      remediated: flow(mine, CURRENT.from, CURRENT.to).remediated,
      reassignedRate: rate(ticketed.filter((f) => f.reassignments > 0).length, ticketed.length),
    };
  });

  const routing = Object.fromEntries(
    (['automation', 'manual'] as const).map((mode) => {
      // Compare like with like: only tickets for assets that had an owner on record could be routed at all.
      const tickets = findings.filter((f) => f.routedBy === mode && inWindow(f.firstSeen, PREVIOUS.from, CURRENT.to) && (f.ownership === 'verified' || f.ownership === 'stale'));
      const reassigned = tickets.filter((f) => f.reassignments > 0).length;
      return [mode, { tickets: tickets.length, reassigned, reassignedRate: rate(reassigned, tickets.length), medianDaysToAssign: median(tickets.filter((f) => f.assignedDay !== null).map((f) => Math.max(0, (f.assignedDay as number) - f.firstSeen))) }];
    }),
  ) as Analysis['routing'];

  const caveatsByWeek = unreliableWeeks(model.sources.ingestRuns);
  const series: WeekPoint[] = [];
  for (let week = 1; week <= END_DAY / 7; week++) {
    const day = week * 7;
    const openNow = findings.filter((f) => openAt(f, day));
    const weekFlow = flow(findings, day - 7, day);
    series.push({
      week,
      open: openNow.length,
      openStable: openNow.filter((f) => f.cohort === 'stable').length,
      openNew: openNow.filter((f) => f.cohort === 'new').length,
      detected: weekFlow.discoveredInNewScope + weekFlow.newInExistingScope,
      remediated: weekFlow.remediated,
      caveats: caveatsByWeek.get(week) ?? [],
    });
  }

  const weeksPerQuarter = (CURRENT.to - CURRENT.from) / 7;
  return {
    view,
    matched: findings.length,
    current,
    previous,
    backlogChange: change(current),
    stable: { current: stableFlow, backlogChange: change(stableFlow) },
    throughput: {
      previous: previous.remediated / weeksPerQuarter,
      current: current.remediated / weeksPerQuarter,
      change: previous.remediated === 0 ? null : (current.remediated - previous.remediated) / previous.remediated,
    },
    assignment: { previous: assignment(findings, PREVIOUS.from, PREVIOUS.to), current: assignment(findings, CURRENT.from, CURRENT.to) },
    sla: { previous: sla(findings, PREVIOUS.from, PREVIOUS.to), current: sla(findings, CURRENT.from, CURRENT.to) },
    aging,
    overSla: { count: open.filter(isOverSla).length, open: open.length },
    ownership,
    teams,
    routing,
    series,
    accepted: { open: findings.filter((f) => f.closedAs === 'risk_accepted').length },
    oldest: [...open].sort((a, b) => a.firstSeen - b.firstSeen).slice(0, 25),
  };
}

export interface CoveragePoint {
  week: number;
  inventory: number;
  scanned: number;
  rate: number;
  accounts: number;
}

/** Scan coverage by week. The denominator is the inventory of accounts in scope that week, so onboarding does not look like a coverage drop. */
export function coverageSeries(model: Model): CoveragePoint[] {
  const weeks = new Map<number, CoveragePoint>();
  for (const c of model.sources.coverage) {
    const point = weeks.get(c.week) ?? { week: c.week, inventory: 0, scanned: 0, rate: 0, accounts: 0 };
    point.inventory += c.inventoryAssets;
    point.scanned += c.scannedAssets;
    point.accounts++;
    weeks.set(c.week, point);
  }
  return [...weeks.values()].sort((a, b) => a.week - b.week).map((p) => ({ ...p, rate: p.inventory === 0 ? 0 : p.scanned / p.inventory }));
}
