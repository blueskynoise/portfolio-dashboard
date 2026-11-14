import { hashString } from './rng';

/**
 * Finding identity.
 *
 * Three scanners describe the same machine three different ways
 * ("PAY-API-03.corp.example", "asset/pay-api-03", "Pay-Api-03"). Identity
 * is what lets the pipeline recognise them as one thing, and it is the
 * decision everything downstream depends on.
 *
 * A finding is identified by (canonical asset, canonical vulnerability).
 * Port, scan id, source and timestamps are deliberately excluded: they
 * describe an observation, not the problem.
 */

export function canonicalAssetId(raw: string): string {
  let value = raw.trim().toLowerCase();
  const slash = value.lastIndexOf('/');
  if (slash >= 0) value = value.slice(slash + 1);
  const dot = value.indexOf('.');
  if (dot >= 0) value = value.slice(0, dot);
  return value;
}

export function canonicalVulnId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function findingKey(assetId: string, vulnId: string): string {
  return `${assetId}::${vulnId}`;
}

/** Short, stable, human-quotable id derived from the key. */
export function findingId(key: string): string {
  return `F-${hashString(key).toString(36).toUpperCase().padStart(7, '0')}`;
}
