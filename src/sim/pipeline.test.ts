import { describe, expect, it } from 'vitest';
import { runSimulation, type SimulationResult } from './pipeline';
import { buildActions } from './remediation';
import { assessRisk, RISK_THRESHOLDS } from './risk';
import {
  ALL_FAULTS,
  CYCLES,
  FAULT_KEYS,
  NAIVE_POLICY,
  NO_FAULTS,
  type Asset,
  type FaultConfig,
  type Vuln,
} from './types';
import { cleanRecordCount, generateWorld } from './world';

const SEEDS = [1, 7, 2026];
const SIZE = 2000;

const only = (...keys: (keyof FaultConfig)[]): FaultConfig => {
  const faults = { ...NO_FAULTS };
  for (const key of keys) faults[key] = true;
  return faults;
};

const everyCombination = (): FaultConfig[] =>
  Array.from({ length: 2 ** FAULT_KEYS.length }, (_, mask) => {
    const faults = { ...NO_FAULTS };
    FAULT_KEYS.forEach((key, bit) => {
      faults[key] = (mask & (1 << bit)) !== 0;
    });
    return faults;
  });

const openKeys = (result: SimulationResult): string[] =>
  result.findings.filter((f) => f.finding.status !== 'resolved').map((f) => f.finding.key).sort();

const truthOpenKeys = (result: SimulationResult): string[] =>
  result.world.truth.filter((t) => t.active[CYCLES - 1]).map((t) => t.key).sort();

const actionSummary = (result: SimulationResult) =>
  result.actions.map((a) => ({ pkg: a.pkg, urgent: a.urgent.map((u) => u.finding.key), riskRemoved: a.riskRemoved }));

const counter = (result: SimulationResult, cycle: number, stage: keyof SimulationResult['cycles'][number]['stages'], code: string) =>
  (result.cycles[cycle - 1]?.stages[stage].counters as Record<string, number>)[code] ?? 0;

describe('world generation', () => {
  it.each([1000, 2000, 10_000])('emits exactly %i alerts when nothing goes wrong', (alertCount) => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed, alertCount);
      expect(world.truth.reduce((sum, f) => sum + cleanRecordCount(f), 0)).toBe(alertCount);
      expect(runSimulation({ seed, alertCount, faults: NO_FAULTS }).funnel.received).toBe(alertCount);
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    expect(generateWorld(7, SIZE)).toEqual(generateWorld(7, SIZE));
    expect(generateWorld(7, SIZE).truth).not.toEqual(generateWorld(8, SIZE).truth);
  });
});

describe('pipeline', () => {
  it('produces identical results for identical input', () => {
    const config = { seed: 7, alertCount: SIZE, faults: ALL_FAULTS };
    expect(runSimulation(config)).toEqual(runSimulation(config));
  });

  it('on a clean run, ends in exactly the true state', () => {
    for (const seed of SEEDS) {
      const result = runSimulation({ seed, alertCount: SIZE, faults: NO_FAULTS });
      expect(openKeys(result)).toEqual(truthOpenKeys(result));
      expect(result.everWronglyClosed).toEqual([]);
      expect(result.funnel.afterDedupe).toBe(result.funnel.received);
    }
  });

  it('narrows at every step of the funnel', () => {
    const { funnel } = runSimulation({ seed: 7, alertCount: 10_000, faults: ALL_FAULTS });
    const steps = [funnel.received, funnel.afterDedupe, funnel.uniqueFindings, funnel.stillOpen, funnel.actNow, funnel.actions];
    expect([...steps].sort((a, b) => b - a)).toEqual(steps);
    expect(funnel.actions).toBeGreaterThan(0);
  });

  describe('under all 64 combinations of faults', () => {
    const combinations = everyCombination();

    it('never closes a finding that still exists (safety)', () => {
      for (const seed of SEEDS) {
        for (const faults of combinations) {
          const result = runSimulation({ seed, alertCount: SIZE, faults });
          expect(result.everWronglyClosed, JSON.stringify({ seed, faults })).toEqual([]);
        }
      }
    });

    it('recovers to exactly the true state once the faults stop (liveness)', () => {
      for (const seed of SEEDS) {
        for (const faults of combinations) {
          const result = runSimulation({ seed, alertCount: SIZE, faults });
          expect(openKeys(result), JSON.stringify({ seed, faults })).toEqual(truthOpenKeys(result));
          expect(result.cycles.at(-1)?.snapshot.pending).toBe(0);
        }
      }
    });

    it('recommends the same work no matter what went wrong on the way', () => {
      for (const seed of SEEDS) {
        const clean = actionSummary(runSimulation({ seed, alertCount: SIZE, faults: NO_FAULTS }));
        for (const faults of combinations) {
          expect(actionSummary(runSimulation({ seed, alertCount: SIZE, faults })), JSON.stringify({ seed, faults })).toEqual(clean);
        }
      }
    });
  });

  describe('the same faults break a naive pipeline', () => {
    // These tests exist to show the safety tests above can fail.
    it.each<keyof FaultConfig>(['disappearing', 'partialFailure', 'outOfOrder', 'missingUpdates'])(
      '%s alone makes it close live findings',
      (fault) => {
        const result = runSimulation({ seed: 7, alertCount: 10_000, faults: only(fault) }, NAIVE_POLICY);
        expect(result.everWronglyClosed.length).toBeGreaterThan(0);
      },
    );

    it('and it is fine when nothing goes wrong, which is why it ships', () => {
      const result = runSimulation({ seed: 7, alertCount: 10_000, faults: NO_FAULTS }, NAIVE_POLICY);
      expect(result.everWronglyClosed).toEqual([]);
    });
  });
});

describe('failure scenarios', () => {
  it('HTTP 429: every page is eventually retrieved and nothing is lost', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('rateLimit') });
    const limited = result.cycles.reduce((sum, c) => sum + c.transport.rateLimited, 0);
    expect(limited).toBeGreaterThan(0);
    expect(result.cycles.every((c) => c.transport.failedPages === 0)).toBe(true);
    expect(result.cycles.every((c) => c.sync.harbor.complete && c.sync.lantern.complete)).toBe(true);
    expect(result.cycles.reduce((sum, c) => sum + c.transport.waitedMs, 0)).toBeGreaterThanOrEqual(limited * 1000);
    expect(result.funnel.received).toBe(SIZE);
  });

  it('duplicate events: every redelivery is dropped and nothing else is', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('duplicates') });
    expect(result.funnel.received).toBeGreaterThan(SIZE);
    expect(result.funnel.afterDedupe).toBe(SIZE);
  });

  it('partial failure: an incomplete scan suspends absence decisions for that scan', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('partialFailure') });
    const clean = runSimulation({ seed: 7, alertCount: SIZE, faults: NO_FAULTS });
    const second = result.cycles[1];
    expect(second?.sync.harbor.complete).toBe(false);
    expect(second?.transport.failedPages).toBe(1);
    expect(counter(result, 2, 'reconcile', 'held_incomplete_scan')).toBeGreaterThan(0);
    expect(counter(result, 2, 'reconcile', 'absence_pending')).toBe(0);
    // The clean run does start counting absences at scan 2; the held ones just take a scan longer.
    expect(counter(clean, 2, 'reconcile', 'absence_pending')).toBeGreaterThan(0);
    expect(result.cycles[1]?.verification.awaitingConfirmation).toBeGreaterThan(0);
  });

  it('partial failure: the change-feed cursor is held, then resumes and re-reads safely', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('partialFailure') });
    const [, , third, fourth] = result.cycles;
    expect(third?.sync.lantern.complete).toBe(false);
    expect(third?.sync.lantern.cursorAfter).toBe(third?.sync.lantern.cursorBefore);
    // The inventory sweep repaired the gap in the same cycle...
    expect(counter(result, 3, 'reconcile', 'drift_repaired')).toBeGreaterThan(0);
    // ...so when the cursor resumes, the re-read records are recognised and dropped.
    expect(fourth?.sync.lantern.cursorBefore).toBe(third?.sync.lantern.cursorAfter);
    expect(fourth?.sync.lantern.cursorAfter).toBeGreaterThan(fourth?.sync.lantern.cursorBefore ?? Infinity);
    expect(counter(result, 4, 'dedupe', 'duplicate_dropped')).toBe(counter(result, 3, 'reconcile', 'drift_repaired'));
  });

  it('missing updates: the sweep finds and repairs what the feed never mentioned', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('missingUpdates') });
    const repaired = result.cycles.reduce((sum, c) => sum + (c.stages.reconcile.counters.drift_repaired ?? 0), 0);
    expect(repaired).toBeGreaterThan(0);
    expect(result.funnel.received).toBe(SIZE - repaired);
    expect(result.everWronglyClosed).toEqual([]);
  });

  it('out-of-order events: stale updates are ignored by version', () => {
    const result = runSimulation({ seed: 7, alertCount: 10_000, faults: only('outOfOrder') });
    const stale = result.cycles.reduce((sum, c) => sum + (c.stages.identity.counters.stale_ignored ?? 0), 0);
    expect(stale).toBeGreaterThan(0);
    // At least one "fixed" arrived a day late, after its re-open, and was ignored.
    const lateFix = result.findings.some((f) =>
      f.finding.history.some((h) => h.code === 'stale_ignored' && h.cycle === 3),
    );
    expect(lateFix).toBe(true);
  });

  it('a finding that vanishes for one scan is held pending and comes back as open', () => {
    const result = runSimulation({ seed: 7, alertCount: SIZE, faults: only('disappearing') });
    const flaked = result.findings.filter((f) => f.finding.history.some((h) => h.code === 'reappeared' && h.cycle === 4));
    expect(flaked.length).toBeGreaterThan(0);
    for (const { finding } of flaked) {
      const codes = finding.history.map((h) => h.code);
      expect(codes).toContain('absence_pending');
      expect(codes).not.toContain('absence_confirmed');
      expect(finding.status).toBe('open');
      expect(finding.reopenCount).toBe(0);
    }
    expect(counter(result, 3, 'reconcile', 'held_asset_not_scanned')).toBeGreaterThan(0);
  });
});

describe('risk and remediation', () => {
  const vuln: Vuln = { id: 'SYN-2026-0001', title: 't', cvss: 9.8, exploit: 'known', pkg: 'openwidget', fixVersion: '2.0.0' };
  const asset: Asset = { id: 'pay-api-01', env: 'prod', exposure: 'internet', tier: 1, owner: 'Payments', coveredBy: ['harbor'] };

  it('the same vulnerability ranks very differently depending on where it is', () => {
    const exposed = assessRisk(vuln, asset);
    const devBox = assessRisk(vuln, { ...asset, env: 'dev', exposure: 'internal', tier: 3 });
    expect(exposed).toMatchObject({ score: 98, band: 'act' });
    expect(devBox.band).toBe('backlog');
    expect(devBox.score).toBeLessThan(RISK_THRESHOLDS.schedule);
  });

  it('each factor only ever lowers or keeps the score', () => {
    const base = assessRisk(vuln, asset).score;
    expect(assessRisk({ ...vuln, exploit: 'poc' }, asset).score).toBeLessThan(base);
    expect(assessRisk({ ...vuln, exploit: 'none' }, asset).score).toBeLessThan(assessRisk({ ...vuln, exploit: 'poc' }, asset).score);
    expect(assessRisk(vuln, { ...asset, exposure: 'internal' }).score).toBeLessThan(base);
    expect(assessRisk(vuln, { ...asset, env: 'staging' }).score).toBeLessThan(base);
    expect(assessRisk(vuln, { ...asset, tier: 2 }).score).toBeLessThan(base);
    expect(assessRisk({ ...vuln, cvss: 5 }, asset).score).toBeLessThan(base);
  });

  it('groups urgent findings into pieces of work, ranked by risk removed', () => {
    const result = runSimulation({ seed: 7, alertCount: 10_000, faults: NO_FAULTS });
    const open = result.findings.filter((f) => f.finding.status !== 'resolved');
    const actions = buildActions(open);
    const urgentTotal = actions.reduce((sum, a) => sum + a.urgent.length, 0);
    expect(urgentTotal).toBe(result.funnel.actNow);
    expect(new Set(actions.map((a) => a.pkg)).size).toBe(actions.length);
    for (const action of actions) {
      expect(action.urgent.every((u) => u.vuln.pkg === action.pkg && u.risk.band === 'act')).toBe(true);
      expect(action.riskRemoved).toBe(action.urgent.reduce((sum, u) => sum + u.risk.score, 0));
    }
    const ranked = actions.map((a) => a.riskRemoved);
    expect([...ranked].sort((a, b) => b - a)).toEqual(ranked);
  });
});
