import type { DecisionCode, FaultConfig, SimConfig, StageId } from '../sim';

export const DEFAULT_CONFIG: SimConfig = {
  seed: 11,
  alertCount: 10_000,
  faults: {
    rateLimit: true,
    duplicates: true,
    missingUpdates: false,
    outOfOrder: false,
    partialFailure: false,
    disappearing: false,
  },
};

export const SIZES = [1000, 10_000, 25_000] as const;

export const FAULTS: { key: keyof FaultConfig; label: string; blurb: string }[] = [
  { key: 'rateLimit', label: 'HTTP 429 rate limiting', blurb: 'The scanners tell us to slow down.' },
  { key: 'duplicates', label: 'Duplicate events', blurb: 'The same record, delivered again.' },
  { key: 'missingUpdates', label: 'Missing updates', blurb: 'The change feed quietly skips some.' },
  { key: 'outOfOrder', label: 'Out-of-order records', blurb: 'Old news arrives after new news.' },
  { key: 'partialFailure', label: 'Partial ingestion failure', blurb: 'One page of results never loads.' },
  { key: 'disappearing', label: 'Disappearing findings', blurb: 'Gone from a scan. Not actually fixed.' },
];

export interface StageCopy {
  name: string;
  short: string;
  unit: string;
  plain: string;
  rule: string[];
  file: string;
}

export const STAGES: Record<StageId, StageCopy> = {
  ingest: {
    name: 'Ingest',
    short: 'Collect what three scanners have to say.',
    unit: 'records in',
    plain:
      'Each scanner is collected the way it wants to be: one is pulled as full scans, page by page; one is a change feed read from a saved position; one pushes events whenever it likes. When a request fails, it is retried patiently. When it keeps failing, the page is recorded as missing. It is never treated as empty.',
    rule: [
      'on 429 → wait exactly Retry-After, then retry',
      'on 503 → exponential backoff with jitter, max 5 attempts',
      'on give-up → mark the scan incomplete; keep everything else',
      'change-feed cursor only advances past pages we actually hold',
    ],
    file: 'src/sim/transport.ts · sources.ts',
  },
  normalize: {
    name: 'Normalize',
    short: 'Three dialects, one vocabulary.',
    unit: 'normalized',
    plain:
      'One scanner says “PAY-API-03.corp.example”, another “asset/pay-api-03”, the third “Pay-Api-03”. They disagree about how to spell severity and what a timestamp looks like. Everything is translated into one shape. A record that cannot be understood is rejected with a reason rather than guessed at.',
    rule: [
      'asset → lower-case, strip path and domain',
      'vulnerability id → upper-case',
      'severity → critical | high | medium | low',
      'keep the source’s own version (scan, rev, seq) for ordering',
    ],
    file: 'src/sim/normalize.ts',
  },
  dedupe: {
    name: 'Deduplicate',
    short: 'Hearing it twice doesn’t make it two things.',
    unit: 'new records',
    plain:
      'Networks retry, pagination overlaps and webhooks are delivered “at least once”. Every record gets an idempotency key built from what the source says it is, not from when it arrived, and a record seen before is dropped.',
    rule: [
      'harbor key = scan + host + plugin + port',
      'lantern key = finding uid + revision',
      'sieve key = event id (not delivery id)',
      'seen before → drop',
    ],
    file: 'src/sim/pipeline.ts',
  },
  identity: {
    name: 'Identity & state',
    short: 'Decide which records are the same problem.',
    unit: 'findings touched',
    plain:
      'A finding is one vulnerability on one asset, however many scanners, ports or scans mention it. Each scanner keeps its own opinion of the finding, and updates are applied by the scanner’s own version number, so a late-arriving old update cannot overwrite a newer one.',
    rule: [
      'identity = (canonical asset, canonical vulnerability)',
      'update.version < stored.version → ignore as stale',
      'status = open if any source says open',
      'resolved only when every source agrees it is gone',
    ],
    file: 'src/sim/identity.ts · store.ts',
  },
  reconcile: {
    name: 'Reconcile',
    short: 'Work out what silence means.',
    unit: 'still open',
    plain:
      'When a scan stops mentioning a finding, it might be fixed. Or the scan died halfway, or the machine was switched off. Absence only counts when the scan finished and reached the asset, and then it has to happen twice in a row. Separately, our state is compared with the change feed’s inventory, and anything the feed forgot to tell us is fetched.',
    rule: [
      'scan incomplete → hold state',
      'asset not reached → hold state',
      'absent from 1 qualifying scan → pending, still counted as open',
      'absent from 2 in a row → resolved',
      'inventory rev > our rev → fetch and apply',
    ],
    file: 'src/sim/store.ts · pipeline.ts',
  },
  risk: {
    name: 'Risk context',
    short: 'Ask where it is, not just how scary it sounds.',
    unit: 'matter now',
    plain:
      'A critical vulnerability on a development box nobody can reach is not an emergency. A medium one on an internet-facing payment service might be. Each open finding is joined with what we know about the asset and whether anyone is actually exploiting the weakness.',
    rule: [
      'score = 100 × severity × exploitation × exposure × environment × criticality',
      'score ≥ 55 → act now',
      'score ≥ 25 → schedule',
      'otherwise → backlog',
    ],
    file: 'src/sim/risk.ts',
  },
  prioritize: {
    name: 'Prioritize',
    short: 'Turn findings into work.',
    unit: 'pieces of work',
    plain:
      'Nobody fixes “a finding”. They upgrade a package on some machines. Urgent findings are grouped by the change that fixes them and ranked by how much risk that one change removes.',
    rule: ['group urgent findings by fix (package upgrade)', 'rank by total risk removed', 'note what else the same change closes'],
    file: 'src/sim/remediation.ts',
  },
};

export const DECISIONS: Partial<Record<DecisionCode, { label: string; tone?: 'good' | 'warn' | 'bad' | 'info' }>> = {
  page_ok: { label: 'Pages retrieved' },
  retry_429: { label: 'Rate-limited, waited and retried', tone: 'warn' },
  retry_503: { label: 'Server error, backed off and retried', tone: 'warn' },
  page_failed: { label: 'Pages given up on (recorded as missing)', tone: 'bad' },
  cursor_advanced: { label: 'Change-feed cursor advanced' },
  cursor_held: { label: 'Change-feed cursor held for next sync', tone: 'warn' },
  normalized: { label: 'Records translated' },
  rejected: { label: 'Records rejected as unreadable', tone: 'bad' },
  duplicate_dropped: { label: 'Redeliveries dropped', tone: 'info' },
  created: { label: 'New findings' },
  source_linked: { label: 'Another scanner, same finding: linked', tone: 'info' },
  instance_merged: { label: 'Same finding again (another port): merged', tone: 'info' },
  refreshed: { label: 'Still there: refreshed' },
  fixed_by_source: { label: 'Scanner says fixed', tone: 'good' },
  reopened: { label: 'Closed, then reported again: re-opened', tone: 'warn' },
  stale_ignored: { label: 'Older than what we have: ignored', tone: 'info' },
  absence_pending: { label: 'Missing from one good scan: pending, not closed', tone: 'warn' },
  absence_confirmed: { label: 'Missing from two good scans: closed', tone: 'good' },
  held_incomplete_scan: { label: 'Missing, but the scan was incomplete: held', tone: 'warn' },
  held_asset_not_scanned: { label: 'Missing, but the asset wasn’t reached: held', tone: 'warn' },
  reappeared: { label: 'Came back before we closed it', tone: 'info' },
  drift_repaired: { label: 'Feed never told us: found by sweep and repaired', tone: 'warn' },
};
