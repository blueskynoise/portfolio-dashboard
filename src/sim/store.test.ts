import { describe, expect, it } from 'vitest';
import { FindingStore, type AbsenceCode } from './store';
import { CAREFUL_POLICY, NAIVE_POLICY, type Observation, type SourceId } from './types';

const KEY = 'pay-api-03::SYN-2026-0042';

function obs(source: SourceId, status: 'open' | 'fixed', version: number): Observation {
  return {
    source,
    dedupeKey: `${source}:${version}:${status}`,
    assetId: 'pay-api-03',
    vulnId: 'SYN-2026-0042',
    severity: 'high',
    status,
    version,
    observedAt: version,
    sourceRef: 'ref',
  };
}

function scan(store: FindingStore, cycle: number, options: { complete?: boolean; reached?: boolean } = {}) {
  const codes: AbsenceCode[] = [];
  store.reconcileSnapshot(
    {
      source: 'harbor',
      cycle,
      complete: options.complete ?? true,
      scannedAssets: new Set(options.reached === false ? [] : ['pay-api-03']),
    },
    CAREFUL_POLICY,
    (code) => codes.push(code),
  );
  return codes;
}

describe('applying observations', () => {
  it('creates a finding once and links further sources to it', () => {
    const store = new FindingStore();
    expect(store.apply(obs('harbor', 'open', 1), 1, CAREFUL_POLICY).code).toBe('created');
    expect(store.apply(obs('lantern', 'open', 1), 1, CAREFUL_POLICY).code).toBe('source_linked');
    expect(store.size).toBe(1);
    expect(store.get(KEY)?.alertCount).toBe(2);
  });

  it('ignores an older update that arrives after a newer one', () => {
    const store = new FindingStore();
    store.apply(obs('sieve', 'open', 1), 1, CAREFUL_POLICY);
    store.apply(obs('sieve', 'open', 3), 1, CAREFUL_POLICY); // re-opened
    const late = store.apply(obs('sieve', 'fixed', 2), 2, CAREFUL_POLICY); // the fix in between, a day late
    expect(late.code).toBe('stale_ignored');
    expect(store.get(KEY)?.status).toBe('open');
  });

  it('shows why that matters: arrival-order processing closes a live finding', () => {
    const store = new FindingStore();
    store.apply(obs('sieve', 'open', 1), 1, NAIVE_POLICY);
    store.apply(obs('sieve', 'open', 3), 1, NAIVE_POLICY);
    store.apply(obs('sieve', 'fixed', 2), 2, NAIVE_POLICY);
    expect(store.get(KEY)?.status).toBe('resolved');
  });

  it('is idempotent for a repeated version', () => {
    const store = new FindingStore();
    store.apply(obs('lantern', 'open', 1), 1, CAREFUL_POLICY);
    expect(store.apply(obs('lantern', 'open', 1), 1, CAREFUL_POLICY).code).toBe('instance_merged');
    expect(store.get(KEY)?.status).toBe('open');
  });

  it('closes on an explicit fix and counts a re-open', () => {
    const store = new FindingStore();
    store.apply(obs('lantern', 'open', 1), 1, CAREFUL_POLICY);
    expect(store.apply(obs('lantern', 'fixed', 2), 2, CAREFUL_POLICY).code).toBe('fixed_by_source');
    expect(store.get(KEY)?.status).toBe('resolved');
    expect(store.apply(obs('lantern', 'open', 3), 3, CAREFUL_POLICY).code).toBe('reopened');
    expect(store.get(KEY)).toMatchObject({ status: 'open', reopenCount: 1 });
  });

  it('keeps the most cautious severity when sources disagree', () => {
    const store = new FindingStore();
    store.apply({ ...obs('harbor', 'open', 1), severity: 'medium' }, 1, CAREFUL_POLICY);
    store.apply({ ...obs('lantern', 'open', 1), severity: 'critical' }, 1, CAREFUL_POLICY);
    store.apply({ ...obs('sieve', 'open', 1), severity: 'low' }, 1, CAREFUL_POLICY);
    expect(store.get(KEY)?.severity).toBe('critical');
  });
});

describe('a finding disappears from a scan', () => {
  const seeded = () => {
    const store = new FindingStore();
    store.apply(obs('harbor', 'open', 1), 1, CAREFUL_POLICY);
    return store;
  };

  it('is not resolved by one quiet scan', () => {
    const store = seeded();
    expect(scan(store, 2)).toEqual(['absence_pending']);
    expect(store.get(KEY)?.status).toBe('pending');
  });

  it('is resolved after two complete scans in a row agree', () => {
    const store = seeded();
    scan(store, 2);
    expect(scan(store, 3)).toEqual(['absence_confirmed']);
    expect(store.get(KEY)?.status).toBe('resolved');
  });

  it('is held, not counted, when the scan was incomplete', () => {
    const store = seeded();
    expect(scan(store, 2, { complete: false })).toEqual(['held_incomplete_scan']);
    expect(scan(store, 3, { complete: false })).toEqual(['held_incomplete_scan']);
    expect(store.get(KEY)).toMatchObject({ status: 'open' });
    expect(store.get(KEY)?.obs.harbor?.missed).toBe(0);
  });

  it('is held when the scanner never reached the asset', () => {
    const store = seeded();
    expect(scan(store, 2, { reached: false })).toEqual(['held_asset_not_scanned']);
    expect(store.get(KEY)?.status).toBe('open');
  });

  it('an unusable scan does not break or complete a pending streak', () => {
    const store = seeded();
    scan(store, 2); // pending, missed = 1
    scan(store, 3, { complete: false }); // tells us nothing
    expect(store.get(KEY)?.status).toBe('pending');
    expect(scan(store, 4)).toEqual(['absence_confirmed']);
  });

  it('goes back to open, without a "re-open", if it reappears before confirmation', () => {
    const store = seeded();
    scan(store, 2);
    expect(store.apply(obs('harbor', 'open', 3), 3, CAREFUL_POLICY).code).toBe('reappeared');
    expect(store.get(KEY)).toMatchObject({ status: 'open', reopenCount: 0 });
    // The streak starts over.
    expect(scan(store, 4)).toEqual(['absence_pending']);
  });

  it('does not let one scanner’s silence overrule another scanner’s evidence', () => {
    const store = seeded();
    store.apply(obs('lantern', 'open', 1), 1, CAREFUL_POLICY);
    scan(store, 2);
    scan(store, 3);
    expect(store.get(KEY)?.obs.harbor?.status).toBe('absent_confirmed');
    expect(store.get(KEY)?.status).toBe('open');
    store.apply(obs('lantern', 'fixed', 2), 4, CAREFUL_POLICY);
    expect(store.get(KEY)?.status).toBe('resolved');
  });

  it('a naive policy closes it on the first quiet scan, complete or not', () => {
    const store = seeded();
    store.reconcileSnapshot(
      { source: 'harbor', cycle: 2, complete: false, scannedAssets: new Set() },
      NAIVE_POLICY,
      () => undefined,
    );
    expect(store.get(KEY)?.status).toBe('resolved');
  });
});
