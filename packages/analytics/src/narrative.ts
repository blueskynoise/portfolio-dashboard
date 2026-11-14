import { CURRENT, type Model, type Ownership } from './model';
import { analyze, coverageSeries, type Analysis } from './metrics';
import { resolveOwnership } from './pipeline';

/**
 * From numbers to a reading of them.
 *
 * Every sentence is generated from the analysis it is given, and tagged
 * with what kind of claim it is:
 *
 *   computed     a measurement. True of this dataset by arithmetic.
 *   explanation  an account that the measurements support.
 *   hypothesis   a possible cause. Consistent with the data, not shown by it.
 *   caveat       a reason to trust a number less.
 *
 * The tags are the point. Mixing them up is how a dashboard ends up
 * asserting causes it has only seen correlations for.
 */

export type StatementKind = 'computed' | 'explanation' | 'hypothesis' | 'caveat';

export interface Statement {
  kind: StatementKind;
  text: string;
}

export type Verdict = 'scope_expansion' | 'deteriorating' | 'improving' | 'mixed' | 'no_baseline' | 'too_few';

export interface Measure {
  metric: string;
  baseline: string;
  /** What movement would count as the intervention working. */
  watchFor: string;
}

export interface Story {
  verdict: Verdict;
  headline: string;
  conclusion: string;
  confidence: { level: 'normal' | 'reduced'; reasons: string[] };
  whatIsHappening: Statement[];
  whyIsItHappening: Statement[];
  whatShouldWeDo: { action: string; rationale: string; keep: string[] } | null;
  howWillWeKnow: Measure[];
}

const pct = (value: number | null, digits = 0): string => (value === null ? 'n/a' : `${(value * 100).toFixed(digits)}%`);
const signed = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(0)}%`);
const n = (value: number): string => value.toLocaleString('en-US');
const days = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value)} day${Math.round(value) === 1 ? '' : 's'}`);
const SEVERITY_NOUN = { critical: 'critical findings', critical_high: 'critical and high findings', all: 'findings' } as const;
const UNOWNED: readonly Ownership[] = ['stale', 'missing', 'unreconciled'];
const MIN_SAMPLE = 20;

export interface OwnershipCoverage {
  assets: number;
  verified: number;
  rate: number;
}

/** Share of inventory assets with a verified owner. An asset-level measure, independent of findings. */
export function ownershipCoverage(model: Model, cohort: 'all' | 'stable' | 'new' = 'all'): OwnershipCoverage {
  const catalog = new Map(model.sources.catalog.map((s) => [s.name, s]));
  const newAccounts = new Set(model.sources.accounts.filter((a) => a.onboardedDay > 0).map((a) => a.name));
  const assets = model.sources.inventory.filter((a) => cohort === 'all' || (cohort === 'new') === newAccounts.has(a.account));
  const verified = assets.filter((a) => resolveOwnership(a.tags.service, catalog).ownership === 'verified').length;
  return { assets: assets.length, verified, rate: assets.length === 0 ? 0 : verified / assets.length };
}

export function tell(model: Model, analysis: Analysis): Story {
  const { view, current: flow } = analysis;
  const noun = SEVERITY_NOUN[view.severity];
  const what: Statement[] = [];
  const why: Statement[] = [];
  const reasons: string[] = [];
  const net = flow.end - flow.start;

  // ── What is happening ──────────────────────────────────────────────
  what.push({
    kind: 'computed',
    text:
      flow.start === 0
        ? `There are ${n(flow.end)} open ${noun} in this view. None were open when the quarter began, so there is no starting point to compare against.`
        : `Open ${noun} went from ${n(flow.start)} to ${n(flow.end)} over the quarter (${signed(analysis.backlogChange)}).`,
  });
  what.push({
    kind: 'computed',
    text: `In: ${n(flow.discoveredInNewScope)} found in accounts scanned for the first time, ${n(flow.newInExistingScope)} new in accounts already scanned, ${n(flow.reopened)} reopened. Out: ${n(flow.remediated)} fixed${flow.riskAccepted > 0 ? `, ${n(flow.riskAccepted)} closed as accepted risk` : ''}.`,
  });
  if (view.cohort === 'all' && flow.start > 0) {
    what.push({
      kind: 'computed',
      text: `In the accounts that were scanned for the whole period, the backlog went from ${n(analysis.stable.current.start)} to ${n(analysis.stable.current.end)} (${signed(analysis.stable.backlogChange)}).`,
    });
  }
  if (analysis.previous.remediated > 0 || flow.remediated > 0) {
    what.push({
      kind: 'computed',
      text: `Fixes averaged ${analysis.throughput.current.toFixed(1)} a week, against ${analysis.throughput.previous.toFixed(1)} the quarter before (${signed(analysis.throughput.change)}).`,
    });
  }

  // ── Verdict ────────────────────────────────────────────────────────
  let verdict: Verdict;
  let headline: string;
  let conclusion: string;
  const stableChange = analysis.stable.backlogChange;
  if (flow.end < MIN_SAMPLE && flow.start < MIN_SAMPLE) {
    verdict = 'too_few';
    headline = 'Too few findings in this view to say anything firm.';
    conclusion = `With ${n(flow.end)} open ${noun}, one or two tickets move every percentage on this page. Widen the filters before drawing a conclusion.`;
  } else if (flow.start === 0) {
    verdict = 'no_baseline';
    headline = 'Everything here was discovered this quarter.';
    conclusion = 'These accounts were not being scanned before, so the backlog did not grow: it became visible. A percentage change from zero would be meaningless and is not shown.';
  } else if (net > 0 && view.cohort === 'all' && flow.discoveredInNewScope >= net && (stableChange ?? 0) <= 0.02) {
    verdict = 'scope_expansion';
    headline = 'The backlog grew because we can see more, not because the program got worse.';
    conclusion = `The increase of ${n(net)} is smaller than the ${n(flow.discoveredInNewScope)} findings that arrived with newly scanned accounts. Where coverage did not change, the backlog ${stableChange !== null && stableChange < -0.005 ? 'fell' : 'held steady'}. Those vulnerabilities existed before this quarter; what changed is that they are now counted.`;
  } else if (net > 0 && (view.cohort !== 'all' ? (analysis.backlogChange ?? 0) > 0.05 : (stableChange ?? 0) > 0.05)) {
    verdict = 'deteriorating';
    headline = 'The backlog is growing in places we were already watching.';
    conclusion = `New visibility does not account for this. Within a fixed set of accounts, more ${noun} arrived or reopened (${n(flow.newInExistingScope + flow.reopened)}) than were closed (${n(flow.remediated + flow.riskAccepted)}).`;
  } else if (net < 0) {
    verdict = 'improving';
    headline = 'The backlog is shrinking.';
    conclusion = `More ${noun} were closed (${n(flow.remediated + flow.riskAccepted)}) than arrived (${n(flow.discoveredInNewScope + flow.newInExistingScope + flow.reopened)}). A shrinking count is not the same as shrinking risk: check below that the old, unowned work is going down too, and not only the easy tickets.`;
  } else {
    verdict = 'mixed';
    headline = 'No single explanation fits.';
    conclusion = 'The backlog moved, but neither new visibility nor a change in a fixed set of accounts explains it on its own. Narrow the view by team or ownership to see where the movement is.';
  }

  // ── Why ────────────────────────────────────────────────────────────
  const openTotal = analysis.overSla.open;
  const unowned = analysis.ownership.filter((o) => UNOWNED.includes(o.ownership));
  const verified = analysis.ownership.find((o) => o.ownership === 'verified');
  const unownedOpen = unowned.reduce((sum, o) => sum + o.open, 0);
  const unownedOver = unowned.reduce((sum, o) => sum + o.overSla, 0);
  const unownedRate = unownedOpen === 0 ? null : unownedOver / unownedOpen;
  const ownershipMatters = view.ownership === null && openTotal >= MIN_SAMPLE && verified !== undefined && verified.open >= 5 && unownedOpen >= 5 && unownedRate !== null && verified.overSlaRate !== null && unownedRate > verified.overSlaRate * 1.2;

  if (analysis.throughput.change !== null && analysis.throughput.change > 0.05 && net > 0) {
    why.push({
      kind: 'explanation',
      text: `Faster fixing did not shrink the backlog because more work arrived than left: ${n(flow.discoveredInNewScope + flow.newInExistingScope + flow.reopened)} in, ${n(flow.remediated + flow.riskAccepted)} out. Throughput measures effort, not exposure.`,
    });
  }
  if (openTotal > 0) {
    why.push({ kind: 'computed', text: `${n(analysis.overSla.count)} of the ${n(openTotal)} open ${noun} (${pct(analysis.overSla.count / openTotal)}) are past their deadline.` });
  }
  if (ownershipMatters && verified) {
    why.push({
      kind: 'computed',
      text: `Findings on assets without a verified owner make up ${pct(unownedOpen / openTotal)} of what is open and ${pct(analysis.overSla.count === 0 ? null : unownedOver / analysis.overSla.count)} of what is overdue. ${pct(unownedRate)} of them are past deadline, against ${pct(verified.overSlaRate)} where the owner is verified.`,
    });
    // Is that just the newly onboarded accounts? Check inside the accounts that did not change.
    let confounded = true;
    if (view.cohort === 'all') {
      const stable = analyze(model, { ...view, cohort: 'stable' });
      const stableUnowned = stable.ownership.filter((o) => UNOWNED.includes(o.ownership));
      const stableOpen = stableUnowned.reduce((sum, o) => sum + o.open, 0);
      const stableRate = stableOpen === 0 ? null : stableUnowned.reduce((sum, o) => sum + o.overSla, 0) / stableOpen;
      const stableVerified = stable.ownership.find((o) => o.ownership === 'verified')?.overSlaRate ?? null;
      if (stableRate !== null && stableVerified !== null && stableOpen >= 10) {
        confounded = !(stableRate > stableVerified * 1.2);
        why.push({
          kind: 'computed',
          text: `The gap is ${confounded ? 'not' : 'still'} there in the accounts scanned all along: ${pct(stableRate)} overdue without a verified owner, ${pct(stableVerified)} with one. ${confounded ? 'So it may be an effect of recent onboarding rather than of ownership.' : 'So recent onboarding does not explain it away.'}`,
        });
      }
    }
    const unassigned = unowned.reduce((sum, o) => sum + o.unassigned, 0);
    why.push({
      kind: 'hypothesis',
      text: `Missing ownership is slowing remediation: ${n(unassigned)} of those ${n(unownedOpen)} findings have never reached a team. This is an association in the data. It would also appear if unowned assets were simply older or harder to patch, and the only way to tell is to fix ownership for some of them and compare.`,
    });
  }
  const overallRate = openTotal === 0 ? null : analysis.overSla.count / openTotal;
  const slow = analysis.teams.filter((t) => t.open >= 10 && t.overSlaRate !== null && overallRate !== null && t.overSlaRate - overallRate > 0.12).sort((a, b) => (b.overSlaRate ?? 0) - (a.overSlaRate ?? 0));
  if (view.team === null && slow.length > 0) {
    why.push({
      kind: 'computed',
      text: `${slow.map((t) => `${t.team} (${pct(t.overSlaRate)} overdue, median age ${days(t.medianAgeDays)})`).join(' and ')} ${slow.length === 1 ? 'is' : 'are'} well above the ${pct(overallRate)} overall.`,
    });
    why.push({
      kind: 'hypothesis',
      text: 'That could be capacity, harder systems to patch, or work arriving late after being re-routed. The data shows where the queue is slow. It does not show why, and the next step is a conversation with the team, not a target.',
    });
  }
  const auto = analysis.routing.automation;
  const manual = analysis.routing.manual;
  const routingComparable = auto.tickets >= MIN_SAMPLE && manual.tickets >= MIN_SAMPLE;
  if (routingComparable) {
    why.push({
      kind: 'computed',
      text: `For assets with an owner on record, automatically routed tickets reached a team in a median of ${days(auto.medianDaysToAssign)}; manually triaged ones took ${days(manual.medianDaysToAssign)}. Re-routing rates were ${pct(auto.reassignedRate)} and ${pct(manual.reassignedRate)}.`,
    });
  }

  // ── Caveats: how far to trust all of the above ─────────────────────
  const weeksThisQuarter = analysis.series.filter((p) => p.week * 7 > CURRENT.from && p.caveats.length > 0);
  if (weeksThisQuarter.length > 0) {
    reasons.push(`Collection problems in week${weeksThisQuarter.length === 1 ? '' : 's'} ${weeksThisQuarter.map((p) => p.week).join(', ')}`);
    why.push({
      kind: 'caveat',
      text: `Data collection failed or was incomplete in week${weeksThisQuarter.length === 1 ? '' : 's'} ${weeksThisQuarter.map((p) => p.week).join(', ')} (${[...new Set(weeksThisQuarter.flatMap((p) => p.caveats))].join('; ')}). Quarter-end figures were back-filled and are complete; the weekly points in between were reconstructed afterwards, not observed.`,
    });
  }
  const coverage = coverageSeries(model).filter((c) => c.week * 7 > CURRENT.from);
  const lowest = coverage.reduce((min, c) => (c.rate < min.rate ? c : min), coverage[0] ?? { week: 0, rate: 1, inventory: 0, scanned: 0, accounts: 0 });
  if (lowest.rate < 0.9) {
    reasons.push(`Scan coverage dipped to ${pct(lowest.rate)} in week ${lowest.week}`);
    why.push({
      kind: 'caveat',
      text: `Scan coverage fell to ${pct(lowest.rate)} of in-scope assets in week ${lowest.week}, while new accounts were still being enrolled. An asset that was not scanned reports nothing, which is not the same as having nothing.`,
    });
  }
  if (analysis.accepted.open > 0) {
    why.push({
      kind: 'caveat',
      text: `${n(analysis.accepted.open)} ${noun} in this view were closed as accepted risk. They are not counted as open and not counted as fixed: the exposure is still there, by decision, until the acceptance is reviewed.`,
    });
  }

  // ── What to do, and how to know ────────────────────────────────────
  let recommendation: Story['whatShouldWeDo'] = null;
  const measures: Measure[] = [];
  const keep: string[] = [];
  if (routingComparable && (auto.medianDaysToAssign ?? Infinity) < (manual.medianDaysToAssign ?? 0) && (auto.reassignedRate ?? 1) <= (manual.reassignedRate ?? 0) + 0.02) {
    keep.push(`Automated routing. It is faster than manual triage (${days(auto.medianDaysToAssign)} against ${days(manual.medianDaysToAssign)}) without sending more tickets to the wrong team. Leave it alone.`);
  }
  if (model.quality.duplicatesMerged > 0) {
    keep.push(`Cross-scanner deduplication. ${n(model.quality.duplicatesMerged)} records described a finding another scanner had already reported. Without merging them the backlog would be overstated, and nothing would be any less exposed.`);
  }

  if (verdict !== 'too_few') {
    const coverageAll = ownershipCoverage(model);
    if (verdict === 'no_baseline') {
      const coverageNew = ownershipCoverage(model, 'new');
      recommendation = {
        action: 'Treat this quarter as the baseline for these accounts, and tag them before judging them.',
        rationale: 'There is no earlier measurement to compare with, so the only fair statement is where things stand now. Newly enrolled accounts were not held to the tagging rules, which is why so little of this work has an owner to go to.',
        keep,
      };
      measures.push(
        { metric: 'Newly scanned assets with a verified owner', baseline: `${pct(coverageNew.rate)} (${n(coverageNew.verified)} of ${n(coverageNew.assets)})`, watchFor: 'Rising towards the rate in long-standing accounts.' },
        { metric: `Open ${noun} in newly scanned accounts`, baseline: n(flow.end), watchFor: 'Falling from this figure. Next quarter is the first one with a real comparison.' },
        { metric: 'Scan coverage of in-scope assets', baseline: pct(coverageSeries(model).at(-1)?.rate ?? null), watchFor: 'Holding above 95%, so that a falling backlog cannot be a scanner that stopped looking.' },
      );
    } else if (ownershipMatters) {
      recommendation = {
        action: 'Repair ownership data before adding remediation capacity.',
        rationale: `Overdue work is concentrated where nobody is on record as responsible. More people fixing faster does not help a ticket that has no queue to land in. Start with the assets that carry overdue ${noun} and have no service tag or no current owner.`,
        keep,
      };
      measures.push(
        { metric: 'Assets with a verified owner', baseline: `${pct(coverageAll.rate)} (${n(coverageAll.verified)} of ${n(coverageAll.assets)})`, watchFor: 'Rising. This is the intervention itself, so it should move first.' },
        { metric: 'New findings assigned within 7 days', baseline: `${pct(analysis.assignment.current.withinWeekRate)} (${n(analysis.assignment.current.assignedWithinWeek)} of ${n(analysis.assignment.current.eligible)})`, watchFor: 'Rising, with the denominator still counting every finding old enough to have been assigned.' },
        { metric: `Overdue ${noun} without a verified owner`, baseline: n(unownedOver), watchFor: 'Falling in the accounts scanned throughout. Compare like with like; do not let newly onboarded accounts move the number.' },
        { metric: 'Tickets re-routed after assignment', baseline: pct(auto.reassignedRate), watchFor: 'Flat or falling. If it rises, the new ownership records are wrong, and routing on them is sending work to the wrong teams faster.' },
        { metric: 'Fixes that reopen', baseline: n(flow.reopened), watchFor: 'Flat. A rise would mean tickets are being closed to hit a number.' },
      );
    } else if (verdict === 'deteriorating') {
      recommendation = {
        action: 'Find out why closures are not keeping up in this view before changing anything.',
        rationale: 'Ownership is not the obvious constraint here. Look at arrival rate against fix rate per team, and at whether a few systems account for most of the inflow.',
        keep,
      };
      measures.push(
        { metric: 'Arrivals against closures per week', baseline: `${((flow.discoveredInNewScope + flow.newInExistingScope + flow.reopened) / 13).toFixed(1)} in, ${analysis.throughput.current.toFixed(1)} out`, watchFor: 'Closures at or above arrivals for several consecutive weeks.' },
        { metric: 'Deadlines met', baseline: `${pct(analysis.sla.current.rate)} (${n(analysis.sla.current.met)} of ${n(analysis.sla.current.due)} due)`, watchFor: 'Rising, measured over findings that came due, not findings that were closed.' },
      );
    } else {
      recommendation = {
        action: 'No new project is justified by this view. Keep measuring.',
        rationale: 'The controls in place are doing their job here. The useful work is to keep the measurements honest so that a real change is noticed when it happens.',
        keep,
      };
      measures.push(
        { metric: 'Backlog in accounts scanned throughout', baseline: n(analysis.stable.current.end), watchFor: 'Flat or falling. This is the number that is comparable quarter to quarter.' },
        { metric: 'Deadlines met', baseline: `${pct(analysis.sla.current.rate)} (${n(analysis.sla.current.met)} of ${n(analysis.sla.current.due)} due)`, watchFor: 'Holding. A fall here is the early sign of trouble.' },
      );
    }
  }

  return {
    verdict,
    headline,
    conclusion,
    confidence: { level: reasons.length > 0 ? 'reduced' : 'normal', reasons },
    whatIsHappening: what,
    whyIsItHappening: why,
    whatShouldWeDo: recommendation,
    howWillWeKnow: measures,
  };
}
