import { describe, expect, it } from 'vitest';
import { canonicalAssetId, canonicalVulnId, findingId, findingKey } from './identity';
import { normalize } from './normalize';
import type { HarborRaw, LanternRaw, SieveRaw } from './types';

const harbor: HarborRaw = {
  scan_id: 'scan-0003',
  host: 'PAY-API-03.corp.example',
  plugin: 'syn-2026-0042',
  risk: 'High',
  port: 443,
  last_seen: '2026-01-14T06:00:00.000Z',
};
const lantern: LanternRaw = {
  finding_uid: 'lf-00c0ffee',
  rev: 2,
  resource: { name: 'asset/pay-api-03' },
  vulnerability_id: 'syn-2026-0042',
  severity_score: 7.8,
  state: 'REMEDIATED',
  updated_at: 1_768_370_400,
};
const sieve: SieveRaw = {
  delivery_id: 'dlv-000001',
  event_id: 'evt-00c0ffee-1',
  asset: 'Pay-Api-03',
  advisory: 'SYN-2026-0042',
  level: 3,
  action: 'opened',
  seq: 1,
  occurred_at: 1_768_370_400_000,
};

const ok = (result: ReturnType<typeof normalize>) => {
  if (!result.ok) throw new Error(result.reason);
  return result.observation;
};

describe('identity', () => {
  it('reduces three vendor spellings of a machine to one id', () => {
    expect(canonicalAssetId('PAY-API-03.corp.example')).toBe('pay-api-03');
    expect(canonicalAssetId('asset/pay-api-03')).toBe('pay-api-03');
    expect(canonicalAssetId('  Pay-Api-03 ')).toBe('pay-api-03');
    expect(canonicalVulnId('syn-2026-0042')).toBe('SYN-2026-0042');
  });

  it('derives a stable finding id from the key', () => {
    const key = findingKey('pay-api-03', 'SYN-2026-0042');
    expect(findingId(key)).toBe(findingId(key));
    expect(findingId(key)).not.toBe(findingId(findingKey('pay-api-04', 'SYN-2026-0042')));
  });
});

describe('normalize', () => {
  it('maps all three dialects onto the same finding', () => {
    const observations = [
      ok(normalize({ source: 'harbor', raw: harbor })),
      ok(normalize({ source: 'lantern', raw: lantern })),
      ok(normalize({ source: 'sieve', raw: sieve })),
    ];
    const keys = new Set(observations.map((o) => findingKey(o.assetId, o.vulnId)));
    expect([...keys]).toEqual(['pay-api-03::SYN-2026-0042']);
    expect(observations.map((o) => o.severity)).toEqual(['high', 'high', 'high']);
    expect(observations.map((o) => o.status)).toEqual(['open', 'fixed', 'open']);
    expect(observations.map((o) => o.version)).toEqual([3, 2, 1]);
  });

  it('keys a sieve event by event id, so a redelivery is recognisably the same event', () => {
    const first = ok(normalize({ source: 'sieve', raw: sieve }));
    const again = ok(normalize({ source: 'sieve', raw: { ...sieve, delivery_id: 'dlv-000999' } }));
    expect(again.dedupeKey).toBe(first.dedupeKey);
  });

  it('keeps different ports as different records of the same finding', () => {
    const a = ok(normalize({ source: 'harbor', raw: harbor }));
    const b = ok(normalize({ source: 'harbor', raw: { ...harbor, port: 8443 } }));
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(findingKey(a.assetId, a.vulnId)).toBe(findingKey(b.assetId, b.vulnId));
  });

  it('rejects records it cannot understand instead of guessing', () => {
    const bad = [
      normalize({ source: 'harbor', raw: { ...harbor, host: '' } }),
      normalize({ source: 'harbor', raw: { ...harbor, risk: 'Spicy' as HarborRaw['risk'] } }),
      normalize({ source: 'lantern', raw: { ...lantern, state: 'MAYBE' as LanternRaw['state'] } }),
      normalize({ source: 'lantern', raw: { ...lantern, severity_score: 42 } }),
      normalize({ source: 'sieve', raw: { ...sieve, seq: 0 } }),
      normalize({ source: 'sieve', raw: { ...sieve, action: 'ignored' as SieveRaw['action'] } }),
    ];
    for (const result of bad) expect(result.ok).toBe(false);
  });
});
