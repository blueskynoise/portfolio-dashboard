/**
 * Shared vocabulary for the Great Alert Avalanche simulation.
 *
 * Everything here is synthetic. The three "scanners" are fictional and
 * exist to model three delivery styles that real integrations run into:
 *
 *   harbor  – full snapshot scans, pulled page by page. Absence is the
 *             only signal that something was fixed.
 *   lantern – incremental change feed, pulled with a cursor. State
 *             changes are explicit and carry a revision number.
 *   sieve   – pushed events, delivered at least once and in no
 *             particular order.
 */

export const CYCLES = 5;
export const DAY_MS = 86_400_000;
/** Fixed epoch for the simulated timeline, so output never depends on the wall clock. */
export const T0 = Date.UTC(2026, 0, 12, 6, 0, 0);

export type SourceId = 'harbor' | 'lantern' | 'sieve';
export const SOURCES: readonly SourceId[] = ['harbor', 'lantern', 'sieve'];

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Environment = 'prod' | 'staging' | 'dev';
export type Exposure = 'internet' | 'internal';
export type ExploitStatus = 'known' | 'poc' | 'none';

// ── Inventory and ground truth ────────────────────────────────────────

export interface Asset {
  id: string;
  env: Environment;
  exposure: Exposure;
  /** 1 = the business stops without it, 3 = nobody would notice until Tuesday. */
  tier: 1 | 2 | 3;
  owner: string;
  coveredBy: SourceId[];
}

export interface Vuln {
  id: string;
  title: string;
  cvss: number;
  exploit: ExploitStatus;
  pkg: string;
  fixVersion: string;
}

/** What is actually true in the simulated world, independent of what any scanner says. */
export interface TruthFinding {
  key: string;
  assetId: string;
  vulnId: string;
  /** active[c - 1] is true when the vulnerability really exists during cycle c. */
  active: boolean[];
  sources: SourceId[];
  /** Ports harbor reports this on. One record per port, per scan. */
  harborPorts: number[];
  /** sieve only: opened, fixed and re-opened before the simulation starts. */
  sieveFlapped: boolean;
}

export interface World {
  seed: number;
  alertCount: number;
  assets: Asset[];
  vulns: Vuln[];
  truth: TruthFinding[];
  pageSize: number;
}

// ── Raw records, one shape per source ─────────────────────────────────

export interface HarborRaw {
  scan_id: string;
  host: string;
  plugin: string;
  risk: 'Critical' | 'High' | 'Medium' | 'Low';
  port: number;
  last_seen: string;
}

export interface LanternRaw {
  finding_uid: string;
  rev: number;
  resource: { name: string };
  vulnerability_id: string;
  severity_score: number;
  state: 'ACTIVE' | 'REMEDIATED';
  updated_at: number;
}

export interface SieveRaw {
  delivery_id: string;
  event_id: string;
  asset: string;
  advisory: string;
  level: 1 | 2 | 3 | 4;
  action: 'opened' | 'fixed';
  seq: number;
  occurred_at: number;
}

export type RawRecord =
  | { source: 'harbor'; raw: HarborRaw }
  | { source: 'lantern'; raw: LanternRaw }
  | { source: 'sieve'; raw: SieveRaw };

// ── Conditions a visitor can switch on ────────────────────────────────

export interface FaultConfig {
  /** Source APIs answer some requests with HTTP 429 and a Retry-After. */
  rateLimit: boolean;
  /** Records are delivered more than once. */
  duplicates: boolean;
  /** The change feed silently omits some updates. */
  missingUpdates: boolean;
  /** Events arrive in the wrong order, some of them a day late. */
  outOfOrder: boolean;
  /** A page of results fails for good, however politely we retry. */
  partialFailure: boolean;
  /** Findings vanish from a scan without having been fixed. */
  disappearing: boolean;
}

export const NO_FAULTS: FaultConfig = {
  rateLimit: false,
  duplicates: false,
  missingUpdates: false,
  outOfOrder: false,
  partialFailure: false,
  disappearing: false,
};

export const ALL_FAULTS: FaultConfig = {
  rateLimit: true,
  duplicates: true,
  missingUpdates: true,
  outOfOrder: true,
  partialFailure: true,
  disappearing: true,
};

export const FAULT_KEYS = Object.keys(NO_FAULTS) as (keyof FaultConfig)[];

// ── Normalized pipeline data ──────────────────────────────────────────

export type ObservedStatus = 'open' | 'fixed';

/** One source's claim about one finding, in the pipeline's own vocabulary. */
export interface Observation {
  source: SourceId;
  /** Idempotency key: the same delivery always produces the same key. */
  dedupeKey: string;
  assetId: string;
  vulnId: string;
  severity: Severity;
  status: ObservedStatus;
  /**
   * The source's own ordering token (scan ordinal, revision, sequence).
   * Ordering decisions use this, never arrival order.
   */
  version: number;
  observedAt: number;
  /** Source-side reference, kept so reconciliation can ask about it later. */
  sourceRef: string;
}

export type SourceObsStatus = 'open' | 'fixed' | 'absent_pending' | 'absent_confirmed';

export interface SourceObs {
  status: SourceObsStatus;
  version: number;
  lastSeenCycle: number;
  /** Consecutive complete scans, covering this asset, that did not report it. */
  missed: number;
  sourceRef: string;
}

/**
 * open     – at least one source currently says it exists
 * pending  – nobody is reporting it, but we have not confirmed it is gone
 * resolved – every source that ever reported it agrees it is gone
 */
export type FindingStatus = 'open' | 'pending' | 'resolved';

export interface HistoryEntry {
  cycle: number;
  code: DecisionCode;
  source?: SourceId;
  detail: string;
}

export interface Finding {
  id: string;
  key: string;
  assetId: string;
  vulnId: string;
  severity: Severity;
  obs: Partial<Record<SourceId, SourceObs>>;
  status: FindingStatus;
  firstSeenCycle: number;
  reopenCount: number;
  /** Raw alerts that turned out to be about this one finding. */
  alertCount: number;
  /** Status at the end of each cycle; null before the pipeline had heard of it. */
  statusByCycle: (FindingStatus | null)[];
  history: HistoryEntry[];
}

// ── Decisions ─────────────────────────────────────────────────────────

export type StageId =
  | 'ingest'
  | 'normalize'
  | 'dedupe'
  | 'identity'
  | 'reconcile'
  | 'risk'
  | 'prioritize';

export const STAGE_ORDER: readonly StageId[] = [
  'ingest',
  'normalize',
  'dedupe',
  'identity',
  'reconcile',
  'risk',
  'prioritize',
];

export type DecisionCode =
  // ingest
  | 'page_ok'
  | 'retry_429'
  | 'retry_503'
  | 'page_failed'
  | 'cursor_advanced'
  | 'cursor_held'
  // normalize
  | 'normalized'
  | 'rejected'
  // dedupe
  | 'duplicate_dropped'
  // identity & state
  | 'created'
  | 'source_linked'
  | 'instance_merged'
  | 'refreshed'
  | 'fixed_by_source'
  | 'reopened'
  | 'stale_ignored'
  // reconcile
  | 'absence_pending'
  | 'absence_confirmed'
  | 'held_incomplete_scan'
  | 'held_asset_not_scanned'
  | 'reappeared'
  | 'drift_repaired';

export interface DecisionSample {
  code: DecisionCode;
  text: string;
  findingKey?: string;
}

export interface StageReport {
  id: StageId;
  in: number;
  out: number;
  counters: Partial<Record<DecisionCode, number>>;
  samples: DecisionSample[];
}

// ── Policy: the knobs that separate a careful pipeline from a naive one ─

export interface Policy {
  name: 'careful' | 'naive';
  /** Drop records whose idempotency key has been seen before. */
  idempotentDedupe: boolean;
  /** Apply updates by source version rather than by arrival order. */
  orderByVersion: boolean;
  /** Only treat absence as evidence when the scan finished and covered the asset. */
  requireScanCompleteness: boolean;
  /** Complete scans in a row a finding must be missing from before it is closed. */
  absenceConfirmations: number;
  /** Compare our state with the source's inventory and repair drift. */
  inventorySweep: boolean;
}

export const CAREFUL_POLICY: Policy = {
  name: 'careful',
  idempotentDedupe: true,
  orderByVersion: true,
  requireScanCompleteness: true,
  absenceConfirmations: 2,
  inventorySweep: true,
};

/** What a first draft of this integration usually looks like. Used only for comparison. */
export const NAIVE_POLICY: Policy = {
  name: 'naive',
  idempotentDedupe: false,
  orderByVersion: false,
  requireScanCompleteness: false,
  absenceConfirmations: 1,
  inventorySweep: false,
};
