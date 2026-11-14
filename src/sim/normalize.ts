import { canonicalAssetId, canonicalVulnId } from './identity';
import type { HarborRaw, LanternRaw, Observation, RawRecord, Severity, SieveRaw } from './types';
import { severityFromCvss } from './world';

/**
 * Normalization: three vendor dialects in, one vocabulary out.
 *
 * Raw records are untrusted input. Anything that cannot be understood is
 * rejected with a reason instead of being coerced into something
 * plausible-looking.
 */

export type NormalizeResult = { ok: true; observation: Observation } | { ok: false; reason: string };

const HARBOR_SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};
const SIEVE_SEVERITY: Record<number, Severity> = { 4: 'critical', 3: 'high', 2: 'medium', 1: 'low' };

const reject = (reason: string): NormalizeResult => ({ ok: false, reason });
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function normalizeHarbor(raw: HarborRaw): NormalizeResult {
  if (!isText(raw.host) || !isText(raw.plugin)) return reject('harbor record without host or plugin');
  const ordinal = Number.parseInt(String(raw.scan_id).replace(/^scan-/, ''), 10);
  if (!Number.isInteger(ordinal)) return reject(`harbor record with unreadable scan id "${raw.scan_id}"`);
  const severity = HARBOR_SEVERITY[String(raw.risk).toLowerCase()];
  if (!severity) return reject(`harbor record with unknown risk "${raw.risk}"`);
  const observedAt = Date.parse(raw.last_seen);
  if (Number.isNaN(observedAt)) return reject('harbor record with unreadable last_seen');
  return {
    ok: true,
    observation: {
      source: 'harbor',
      dedupeKey: `harbor:${raw.scan_id}:${raw.host}:${raw.plugin}:${raw.port}`,
      assetId: canonicalAssetId(raw.host),
      vulnId: canonicalVulnId(raw.plugin),
      severity,
      // A snapshot scan only ever lists what it found: presence means open.
      status: 'open',
      version: ordinal,
      observedAt,
      sourceRef: `${raw.host}:${raw.port}`,
    },
  };
}

function normalizeLantern(raw: LanternRaw): NormalizeResult {
  if (!isText(raw.finding_uid) || !isText(raw.resource?.name) || !isText(raw.vulnerability_id)) {
    return reject('lantern record missing uid, resource or vulnerability');
  }
  if (!Number.isInteger(raw.rev) || raw.rev < 1) return reject('lantern record with invalid revision');
  if (raw.state !== 'ACTIVE' && raw.state !== 'REMEDIATED') return reject(`lantern record with unknown state "${raw.state}"`);
  if (typeof raw.severity_score !== 'number' || raw.severity_score < 0 || raw.severity_score > 10) {
    return reject('lantern record with out-of-range severity score');
  }
  return {
    ok: true,
    observation: {
      source: 'lantern',
      dedupeKey: `lantern:${raw.finding_uid}:${raw.rev}`,
      assetId: canonicalAssetId(raw.resource.name),
      vulnId: canonicalVulnId(raw.vulnerability_id),
      severity: severityFromCvss(raw.severity_score),
      status: raw.state === 'ACTIVE' ? 'open' : 'fixed',
      version: raw.rev,
      observedAt: raw.updated_at * 1000,
      sourceRef: raw.finding_uid,
    },
  };
}

function normalizeSieve(raw: SieveRaw): NormalizeResult {
  if (!isText(raw.event_id) || !isText(raw.asset) || !isText(raw.advisory)) {
    return reject('sieve event missing id, asset or advisory');
  }
  if (!Number.isInteger(raw.seq) || raw.seq < 1) return reject('sieve event with invalid sequence');
  if (raw.action !== 'opened' && raw.action !== 'fixed') return reject(`sieve event with unknown action "${raw.action}"`);
  const severity = SIEVE_SEVERITY[raw.level];
  if (!severity) return reject(`sieve event with unknown level "${raw.level}"`);
  return {
    ok: true,
    observation: {
      source: 'sieve',
      // The event id, not the delivery id: a redelivery is the same event.
      dedupeKey: `sieve:${raw.event_id}`,
      assetId: canonicalAssetId(raw.asset),
      vulnId: canonicalVulnId(raw.advisory),
      severity,
      status: raw.action === 'opened' ? 'open' : 'fixed',
      version: raw.seq,
      observedAt: raw.occurred_at,
      sourceRef: raw.event_id,
    },
  };
}

export function normalize(record: RawRecord): NormalizeResult {
  switch (record.source) {
    case 'harbor':
      return normalizeHarbor(record.raw);
    case 'lantern':
      return normalizeLantern(record.raw);
    case 'sieve':
      return normalizeSieve(record.raw);
  }
}
