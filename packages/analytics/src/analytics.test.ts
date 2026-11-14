import { describe, expect, it } from 'vitest';
import { generateSources } from './generate';
import { analyze, coverageSeries, DEFAULT_VIEW, matches, openAt, type View } from './metrics';
import { assignment, flow, median, sla } from './metrics';
import { CURRENT, END_DAY, PREVIOUS, dayToIso, type CloudIssue, type DependencyIssue, type Finding, type Model, type Sources } from './model';
import { ownershipCoverage, tell } from './narrative';
import { assessRun, buildModel, mergeBySameFinding, normalizeCloud, normalizeDependency, resolveOwnership, unreliableWeeks } from './pipeline';

const sources = generateSources();
const model = buildModel(sources);
const view = (overrides: Partial<View> = {}): View => ({ ...DEFAULT_VIEW, ...overrides });

// ── A tiny hand-built estate, for exact arithmetic ────────────────────
const finding = (key: string, overrides: Partial<Finding> = {}): Finding => ({
  key, assetId: `acct/${key}`, assetName: key, account: 'acct', environment: 'prod', cohort: 'stable', service: 'svc', tier: 1, team: 'Payments', ownership: 'verified',
  vulnId: 'SYN-1', severity: 'critical', exploit: false, sources: [{ source: 'cloud_scanner', id: key }], firstSeen: 0, intervals: [{ from: 0, to: null }], closedAs: null,
  ticketKey: 'SEC-1', routedBy: 'automation', assignedDay: 1, reassignments: 0, ...overrides,
});
const cloud = (overrides: Partial<CloudIssue> = {}): CloudIssue => ({
  id: 'ci-1', resource: { account: 'prod-core', name: 'Checkout-VM-01' }, rule: 'syn-2026-0001', severity: 'HIGH', hasExploit: false, status: 'OPEN', firstDetectedAt: dayToIso(10), resolvedAt: null, reopenedAt: null, previouslyResolvedAt: null, ...overrides,
});
const dependency = (overrides: Partial<DependencyIssue> = {}): DependencyIssue => ({
  issue_id: 'dep-1', project: 'syn-corp/prod-core.CHECKOUT-VM-01', advisory: 'syn-2026-0001', cvss: 9.4, fixed: false, introduced: dayToIso(12).slice(0, 10), fixed_on: null, reopened_on: null, previously_fixed_on: null, ...overrides,
});
const tinySources = (extra: Partial<Sources> = {}): Sources => ({
  seed: 0,
  accounts: [{ name: 'prod-core', environment: 'prod', onboardedDay: -400 }],
  inventory: [{ id: 'prod-core/checkout-vm-01', account: 'prod-core', name: 'checkout-vm-01', kind: 'vm', tags: { service: 'checkout' } }],
  catalog: [{ name: 'checkout', tier: 1, owner: 'Payments', ownerCurrent: true }],
  teams: ['Payments', 'Platform'],
  cloudIssues: [], dependencyIssues: [], tickets: [], coverage: [], ingestRuns: [],
  ...extra,
});

describe('collection health', () => {
  it('quarantines a zero-result run instead of reporting zero risk', () => {
    expect(assessRun(0, 400, true).verdict).toBe('quarantine');
    expect(assessRun(60, 400, true).verdict).toBe('quarantine');
    expect(assessRun(380, 400, true).verdict).toBe('accept');
    // A source that normally returns very little can legitimately return nothing.
    expect(assessRun(0, 3, true).verdict).toBe('accept');
    expect(assessRun(400, 400, false).verdict).toBe('failed');
  });

  it('flags the weeks whose figures were reconstructed', () => {
    const weeks = unreliableWeeks(sources.ingestRuns);
    expect([...weeks.keys()].sort((a, b) => a - b)).toEqual([12, 17, 20, 21]);
    expect(weeks.get(20)?.[0]).toMatch(/dependency scanner: auth failed/);
    // The backfill week is trustworthy again.
    expect(weeks.has(22)).toBe(false);
  });
});

describe('normalization', () => {
  it('maps two dialects onto the same finding', () => {
    const a = normalizeCloud(cloud());
    const b = normalizeDependency(dependency());
    if (!a.ok || !b.ok) throw new Error('expected both to normalize');
    expect([a.record.account, a.record.assetName, a.record.vulnId]).toEqual(['prod-core', 'checkout-vm-01', 'SYN-2026-0001']);
    expect([b.record.account, b.record.assetName, b.record.vulnId]).toEqual(['prod-core', 'checkout-vm-01', 'SYN-2026-0001']);
    expect([a.record.severity, b.record.severity]).toEqual(['high', 'critical']);
    expect([a.record.firstSeen, b.record.firstSeen]).toEqual([10, 12]);
  });

  it('rejects what it cannot read, with a reason', () => {
    expect(normalizeCloud(cloud({ severity: 'SPICY' as never }))).toMatchObject({ ok: false, reason: expect.stringMatching(/severity/) });
    expect(normalizeCloud(cloud({ firstDetectedAt: 'yesterday-ish' }))).toMatchObject({ ok: false });
    expect(normalizeDependency(dependency({ project: 'no-separator' }))).toMatchObject({ ok: false });
    expect(normalizeDependency(dependency({ cvss: 42 }))).toMatchObject({ ok: false });
  });
});

describe('deduplication across scanners', () => {
  const pair = (c: Partial<CloudIssue>, d: Partial<DependencyIssue>) => {
    const a = normalizeCloud(cloud(c));
    const b = normalizeDependency(dependency(d));
    if (!a.ok || !b.ok) throw new Error('fixture');
    return mergeBySameFinding([a.record, b.record]);
  };

  it('merges two reports of one finding and keeps both as witnesses', () => {
    const { merged, duplicates } = pair({}, {});
    expect(duplicates).toBe(1);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ severity: 'critical', firstSeen: 10, open: true });
    expect(merged[0]?.sources.map((s) => s.source)).toEqual(['cloud_scanner', 'dependency_scanner']);
  });

  it('stays open until every scanner agrees it is closed', () => {
    const half = pair({ status: 'RESOLVED', resolvedAt: dayToIso(40) }, {});
    expect(half.merged[0]).toMatchObject({ open: true, closed: null });
    const both = pair({ status: 'RESOLVED', resolvedAt: dayToIso(40) }, { fixed: true, fixed_on: dayToIso(43).slice(0, 10) });
    expect(both.merged[0]).toMatchObject({ open: false, closed: 43 });
  });

  it('does not merge different vulnerabilities or different assets', () => {
    const a = normalizeCloud(cloud());
    const b = normalizeCloud(cloud({ id: 'ci-2', rule: 'SYN-2026-0002' }));
    const c = normalizeCloud(cloud({ id: 'ci-3', resource: { account: 'prod-core', name: 'checkout-vm-02' } }));
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture');
    expect(mergeBySameFinding([a.record, b.record, c.record])).toMatchObject({ duplicates: 0, merged: { length: 3 } });
  });
});

describe('ownership', () => {
  const catalog = new Map([
    ['checkout', { owner: 'Payments', ownerCurrent: true, tier: 1 as const }],
    ['wiki', { owner: 'Internal Tools', ownerCurrent: false, tier: 3 as const }],
    ['queue', { owner: null, ownerCurrent: true, tier: 2 as const }],
  ]);

  it('distinguishes the four ways ownership can stand', () => {
    expect(resolveOwnership('checkout', catalog)).toMatchObject({ ownership: 'verified', team: 'Payments' });
    expect(resolveOwnership('wiki', catalog)).toMatchObject({ ownership: 'stale', team: 'Internal Tools' });
    expect(resolveOwnership('queue', catalog)).toMatchObject({ ownership: 'missing', team: null });
    expect(resolveOwnership(undefined, catalog)).toMatchObject({ ownership: 'unreconciled', team: null });
    // A tag naming a service the catalog has never heard of is no better than no tag.
    expect(resolveOwnership('ghost', catalog)).toMatchObject({ ownership: 'unreconciled' });
  });

  it('follows an ownership change in the catalog', () => {
    const base = tinySources({ cloudIssues: [cloud()] });
    expect(buildModel(base).findings[0]).toMatchObject({ ownership: 'verified', team: 'Payments' });
    const moved = buildModel({ ...base, catalog: [{ name: 'checkout', tier: 1, owner: 'Payments', ownerCurrent: false }] });
    expect(moved.findings[0]?.ownership).toBe('stale');
    const orphaned = buildModel({ ...base, catalog: [{ name: 'checkout', tier: 1, owner: null, ownerCurrent: true }] });
    expect(orphaned.findings[0]).toMatchObject({ ownership: 'missing', team: null });
  });
});

describe('building the model', () => {
  it('sets aside a finding on an asset the inventory does not know', () => {
    const result = buildModel(tinySources({ cloudIssues: [cloud(), cloud({ id: 'ci-9', resource: { account: 'prod-core', name: 'mystery-box' } })] }));
    expect(result.findings).toHaveLength(1);
    expect(result.quality.rejected).toEqual([{ source: 'cloud_scanner', id: 'ci-9', reason: 'asset not found in inventory' }]);
  });

  it('treats accepted risk as a decision: closed by the ticket while the scanner still reports it', () => {
    const result = buildModel(
      tinySources({
        cloudIssues: [cloud({ severity: 'MEDIUM' })],
        tickets: [{ key: 'SEC-1', issueRef: 'ci-1', createdAt: dayToIso(11), routedBy: 'automation', assignments: [{ team: 'Payments', at: dayToIso(11) }], resolution: 'risk_accepted', resolvedAt: dayToIso(100), acceptedUntil: dayToIso(280) }],
      }),
    );
    const f = result.findings[0] as Finding;
    expect(f.closedAs).toBe('risk_accepted');
    expect(f.intervals).toEqual([{ from: 10, to: 100 }]);
    const a = analyze(result, view({ severity: 'all' }));
    expect(a.current).toMatchObject({ riskAccepted: 1, remediated: 0 });
    // Not met: accepting a risk is a different outcome from fixing by the deadline.
    expect(sla(result.findings, CURRENT.from, CURRENT.to)).toMatchObject({ due: 1, met: 0 });
  });

  it('keeps a reopened finding as two open periods and counts the reopen', () => {
    const result = buildModel(tinySources({ cloudIssues: [cloud({ status: 'OPEN', previouslyResolvedAt: dayToIso(95), reopenedAt: dayToIso(120) })] }));
    expect(result.findings[0]?.intervals).toEqual([{ from: 10, to: 95 }, { from: 120, to: null }]);
    expect(flow(result.findings, CURRENT.from, CURRENT.to)).toMatchObject({ start: 1, remediated: 1, reopened: 1, end: 1 });
  });

  it('records re-routing and uses the last assignment as when work could start', () => {
    const result = buildModel(
      tinySources({
        cloudIssues: [cloud()],
        tickets: [{ key: 'SEC-1', issueRef: 'ci-1', createdAt: dayToIso(11), routedBy: 'manual', assignments: [{ team: 'Payments', at: dayToIso(11) }, { team: 'Platform', at: dayToIso(30) }], resolution: null, resolvedAt: null, acceptedUntil: null }],
      }),
    );
    expect(result.findings[0]).toMatchObject({ reassignments: 1, assignedDay: 30, team: 'Platform' });
  });

  it('is deterministic for a seed', () => {
    expect(generateSources({ seed: 5, scale: 0.2 })).toEqual(generateSources({ seed: 5, scale: 0.2 }));
    expect(generateSources({ seed: 5, scale: 0.2 }).cloudIssues).not.toEqual(generateSources({ seed: 6, scale: 0.2 }).cloudIssues);
  });

  it('loses nothing: every source record is merged, modeled or rejected', () => {
    const { quality, findings } = model;
    expect(findings.length + quality.duplicatesMerged + quality.rejected.length).toBe(quality.recordsIn.cloud + quality.recordsIn.dependency);
    expect(quality.duplicatesMerged).toBeGreaterThan(0);
  });
});

describe('measurement definitions', () => {
  it('open-at uses half-open intervals', () => {
    const f = finding('a', { intervals: [{ from: 10, to: 20 }] });
    expect([9, 10, 19, 20].map((day) => openAt(f, day))).toEqual([false, true, true, false]);
  });

  it('median handles odd, even and empty sets', () => {
    expect([median([]), median([4]), median([1, 9, 3]), median([1, 2, 3, 10])]).toEqual([null, 4, 3, 2.5]);
  });

  it('measures time to assign over a stated denominator and keeps the unassigned visible', () => {
    const findings = [
      finding('fast', { firstSeen: 100, assignedDay: 101 }),
      finding('slow', { firstSeen: 100, assignedDay: 130 }),
      finding('never', { firstSeen: 100, assignedDay: null }),
      // Detected three days before the window closed: too recent to have "missed" a seven-day target.
      finding('recent', { firstSeen: 179, assignedDay: null }),
      finding('outside', { firstSeen: 50, assignedDay: 51 }),
    ];
    const stats = assignment(findings, CURRENT.from, CURRENT.to);
    expect(stats).toMatchObject({ detected: 4, eligible: 3, assignedWithinWeek: 1, unassigned: 2, medianDays: 15.5 });
    expect(stats.withinWeekRate).toBeCloseTo(1 / 3);
  });

  it('measures deadlines over findings that came due, not findings that were closed', () => {
    const findings = [
      finding('met', { firstSeen: 100, intervals: [{ from: 100, to: 110 }], closedAs: 'remediated' }),
      finding('late', { firstSeen: 100, intervals: [{ from: 100, to: 150 }], closedAs: 'remediated' }),
      finding('open', { firstSeen: 100 }),
      // Closed quickly, but its deadline was in the previous quarter.
      finding('earlier', { firstSeen: 20, intervals: [{ from: 20, to: 22 }], closedAs: 'remediated' }),
    ];
    expect(sla(findings, CURRENT.from, CURRENT.to)).toEqual({ due: 3, met: 1, rate: 1 / 3 });
    expect(sla(findings, PREVIOUS.from, PREVIOUS.to)).toEqual({ due: 1, met: 1, rate: 1 });
    expect(sla([], CURRENT.from, CURRENT.to).rate).toBeNull();
  });
});

describe('the whole dataset is internally consistent', () => {
  const views: View[] = [view(), view({ severity: 'all' }), view({ severity: 'critical_high', cohort: 'stable' }), view({ cohort: 'new' }), view({ team: 'Data', severity: 'all' }), view({ ownership: 'unreconciled', severity: 'all' }), view({ environment: 'prod', tier: 1, severity: 'all' })];

  it('accounts for every change in the backlog, in every view', () => {
    for (const v of views) {
      const a = analyze(model, v);
      for (const f of [a.current, a.previous, a.stable.current]) {
        expect(f.start + f.discoveredInNewScope + f.newInExistingScope + f.reopened - f.remediated - f.riskAccepted, JSON.stringify(v)).toBe(f.end);
      }
      expect(a.previous.end).toBe(a.current.start);
    }
  });

  it('the weekly series lands on the quarter figures and its flows add up to them', () => {
    for (const v of views) {
      const a = analyze(model, v);
      const thisQuarter = a.series.filter((p) => p.week * 7 > CURRENT.from);
      expect(a.series.at(-1)?.open).toBe(a.current.end);
      expect(a.series.find((p) => p.week * 7 === CURRENT.from)?.open).toBe(a.current.start);
      expect(thisQuarter.reduce((sum, p) => sum + p.remediated, 0)).toBe(a.current.remediated);
      expect(thisQuarter.reduce((sum, p) => sum + p.detected, 0)).toBe(a.current.discoveredInNewScope + a.current.newInExistingScope);
      for (const p of a.series) expect(p.openStable + p.openNew).toBe(p.open);
    }
  });

  it('cohorts, teams, ownership groups and age buckets each partition the same total', () => {
    const all = analyze(model, view({ severity: 'all' }));
    const stable = analyze(model, view({ severity: 'all', cohort: 'stable' }));
    const fresh = analyze(model, view({ severity: 'all', cohort: 'new' }));
    expect(stable.current.end + fresh.current.end).toBe(all.current.end);
    expect(stable.current.remediated + fresh.current.remediated).toBe(all.current.remediated);
    expect(all.stable.current).toEqual(stable.current);

    expect(all.ownership.reduce((sum, o) => sum + o.open, 0)).toBe(all.current.end);
    expect(all.aging.reduce((sum, b) => sum + b.count, 0)).toBe(all.current.end);
    expect(all.aging.reduce((sum, b) => sum + b.overSla, 0)).toBe(all.overSla.count);
    expect(all.ownership.reduce((sum, o) => sum + o.overSla, 0)).toBe(all.overSla.count);

    const noTeam = model.findings.filter((f) => f.team === null && openAt(f, END_DAY)).length;
    expect(all.teams.reduce((sum, t) => sum + t.open, 0) + noTeam).toBe(all.current.end);

    const bySeverity = (['critical', 'critical_high', 'all'] as const).map((severity) => analyze(model, view({ severity })).current.end);
    expect(bySeverity[0]).toBeLessThan(bySeverity[1] as number);
    expect(bySeverity[1]).toBeLessThan(bySeverity[2] as number);
  });

  it('newly onboarded accounts contribute nothing before they were scanned', () => {
    const fresh = analyze(model, view({ severity: 'all', cohort: 'new' }));
    expect(fresh.previous).toMatchObject({ start: 0, end: 0, remediated: 0 });
    expect(fresh.current.start).toBe(0);
    expect(fresh.backlogChange).toBeNull();
    expect(fresh.current.newInExistingScope).toBe(0);
  });

  it('a filter only ever narrows', () => {
    const all = analyze(model, view({ severity: 'all' })).matched;
    for (const v of views) expect(analyze(model, v).matched).toBeLessThanOrEqual(all);
    expect(model.findings.filter((f) => matches(f, view({ team: 'Data', severity: 'all' }))).every((f) => f.team === 'Data')).toBe(true);
  });

  it('measures coverage against the accounts in scope each week', () => {
    const series = coverageSeries(model);
    expect(series).toHaveLength(26);
    expect(series[0]?.accounts).toBe(8);
    expect(series.at(-1)?.accounts).toBe(12);
    for (const point of series) expect(point.scanned).toBeLessThanOrEqual(point.inventory);
    const coverage = ownershipCoverage(model);
    expect(ownershipCoverage(model, 'stable').assets + ownershipCoverage(model, 'new').assets).toBe(coverage.assets);
    expect(ownershipCoverage(model, 'new').rate).toBeLessThan(ownershipCoverage(model, 'stable').rate);
  });
});

describe('the narrative says what the numbers say', () => {
  const story = (m: Model, v: View = view()) => tell(m, analyze(m, v));

  it('reads the default view as expanded visibility, and quotes the computed figures', () => {
    const a = analyze(model, view());
    const s = story(model);
    expect(s.verdict).toBe('scope_expansion');
    expect(Math.round((a.backlogChange as number) * 100)).toBe(24);
    expect(a.stable.backlogChange).toBeLessThan(0);
    expect(s.whatIsHappening[0]?.text).toContain(`from ${a.current.start} to ${a.current.end}`);
    expect(s.conclusion).toContain(String(a.current.discoveredInNewScope));
    expect(s.whatIsHappening.every((x) => x.kind === 'computed')).toBe(true);
  });

  it('separates what was measured from what is only suspected', () => {
    const s = story(model);
    const hypothesis = s.whyIsItHappening.find((x) => x.kind === 'hypothesis');
    expect(hypothesis?.text).toMatch(/association/);
    expect(s.whyIsItHappening.some((x) => x.kind === 'caveat' && /weeks? 17, 20, 21/.test(x.text))).toBe(true);
    expect(s.confidence.level).toBe('reduced');
    expect(s.whatShouldWeDo?.action).toMatch(/ownership/i);
    expect(s.whatShouldWeDo?.keep.some((k) => /Automated routing/.test(k))).toBe(true);
    expect(s.howWillWeKnow.length).toBeGreaterThanOrEqual(4);
  });

  it('changes its conclusion when the data changes', () => {
    // The same company, but in the long-scanned accounts nothing detected this quarter was ever fixed.
    const worse: Model = {
      ...model,
      findings: model.findings.map((f) => (f.cohort === 'stable' && f.firstSeen > CURRENT.from ? { ...f, intervals: [{ from: f.firstSeen, to: null }], closedAs: null } : f)),
    };
    const s = story(worse);
    expect(s.verdict).toBe('deteriorating');
    expect(s.headline).toMatch(/already watching/);

    // And with every finding from the new accounts removed, there is no scope story to tell.
    const noNewScope: Model = { ...model, findings: model.findings.filter((f) => f.cohort === 'stable') };
    expect(story(noNewScope).verdict).toBe('improving');
  });

  it('refuses to compare against a baseline that does not exist', () => {
    const s = story(model, view({ cohort: 'new' }));
    expect(s.verdict).toBe('no_baseline');
    expect(s.whatIsHappening[0]?.text).not.toMatch(/%/);
    expect(s.whatShouldWeDo?.action).toMatch(/baseline/);
  });

  it('declines to conclude from a handful of findings', () => {
    const s = story(model, view({ environment: 'dev', tier: 1, team: 'Mobile' }));
    expect(s.verdict).toBe('too_few');
    expect(s.whatShouldWeDo).toBeNull();
    expect(s.howWillWeKnow).toEqual([]);
  });

  it('does not recommend an ownership fix where ownership is not the constraint', () => {
    const s = story(model, view({ ownership: 'verified', severity: 'all' }));
    expect(s.whatShouldWeDo?.action ?? '').not.toMatch(/ownership/i);
    expect(s.whyIsItHappening.some((x) => /Missing ownership/.test(x.text))).toBe(false);
  });
});
