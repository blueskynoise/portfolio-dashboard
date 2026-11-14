/**
 * The synthetic enterprise.
 *
 * Everything in this package describes a company that does not exist.
 * No record comes from, or is modeled on, any real organization's data.
 * Identifiers use a SYN- prefix so they cannot be mistaken for real ones.
 *
 * Time is measured in days from the start of the previous quarter:
 *   previous quarter  days   0..90
 *   this quarter      days  91..181
 * Findings older than that have negative days.
 */

export const QUARTER_DAYS = 91;
export const PREVIOUS = { label: 'Previous quarter', from: 0, to: QUARTER_DAYS } as const;
export const CURRENT = { label: 'This quarter', from: QUARTER_DAYS, to: QUARTER_DAYS * 2 } as const;
export const END_DAY = QUARTER_DAYS * 2;
/** Calendar anchor for display only. */
export const DAY_ZERO = Date.UTC(2026, 3, 6);
export const dayToIso = (day: number): string => new Date(DAY_ZERO + day * 86_400_000).toISOString();
export const isoToDay = (iso: string): number => Math.round((Date.parse(iso) - DAY_ZERO) / 86_400_000);

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Environment = 'prod' | 'staging' | 'dev';
export type Cohort = 'stable' | 'new';
/**
 * How well we know who owns an asset.
 *   verified      tagged to a service whose catalog entry names a current team
 *   stale         the catalog names a team that no longer owns it
 *   missing       tagged to a service with no owner in the catalog
 *   unreconciled  not tagged to any service, so there is nothing to look up
 */
export type Ownership = 'verified' | 'stale' | 'missing' | 'unreconciled';

/** Remediation deadlines by severity, in days. A policy input, not a finding. */
export const SLA_DAYS: Record<Severity, number> = { critical: 14, high: 30, medium: 90, low: 180 };

// ── Source systems, each in its own dialect ───────────────────────────

/** Cloud security scanner: one issue per (resource, rule). */
export interface CloudIssue {
  id: string;
  resource: { account: string; name: string };
  rule: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  hasExploit: boolean;
  status: 'OPEN' | 'RESOLVED';
  firstDetectedAt: string;
  /** Current resolution date; null while open. */
  resolvedAt: string | null;
  reopenedAt: string | null;
  /** If it was reopened: when it had been resolved before that. */
  previouslyResolvedAt: string | null;
}

/** Dependency scanner: one issue per (project, advisory). Different names, different date format, a score instead of a label. */
export interface DependencyIssue {
  issue_id: string;
  project: string;
  advisory: string;
  cvss: number;
  fixed: boolean;
  introduced: string;
  fixed_on: string | null;
  reopened_on: string | null;
  previously_fixed_on: string | null;
}

export interface InventoryAsset {
  id: string;
  account: string;
  name: string;
  kind: 'vm' | 'container' | 'function' | 'database';
  /** Tags as applied by whoever launched it. `service` is the only link to an owner. */
  tags: { service?: string };
}

export interface CloudAccount {
  name: string;
  environment: Environment;
  /** Day the account was first included in scanning. Negative = before the period shown. */
  onboardedDay: number;
}

export interface CatalogService {
  name: string;
  tier: 1 | 2 | 3;
  /** Team named in the service catalog, if any. */
  owner: string | null;
  /** Whether that team still owns the service. False = the entry is out of date. */
  ownerCurrent: boolean;
}

export interface Ticket {
  key: string;
  /** The source issue this ticket was opened for. */
  issueRef: string;
  createdAt: string;
  routedBy: 'automation' | 'manual';
  /** Every team the ticket has been assigned to, in order. More than one means it was re-routed. */
  assignments: { team: string; at: string }[];
  resolution: 'fixed' | 'risk_accepted' | null;
  resolvedAt: string | null;
  /** For accepted risk: when the acceptance must be reviewed. */
  acceptedUntil: string | null;
}

export interface ScanCoverage {
  account: string;
  week: number;
  inventoryAssets: number;
  scannedAssets: number;
}

export type IngestStatus = 'ok' | 'auth_failed' | 'partial' | 'zero_result_quarantined' | 'backfilled';

export interface IngestRun {
  source: 'cloud_scanner' | 'dependency_scanner' | 'inventory' | 'service_catalog' | 'ticketing';
  week: number;
  /** Scope of the run, where a source is collected per account. */
  account?: string;
  status: IngestStatus;
  recordsReceived: number;
  recordsExpected: number;
  note?: string;
}

export interface Sources {
  seed: number;
  accounts: CloudAccount[];
  inventory: InventoryAsset[];
  catalog: CatalogService[];
  teams: string[];
  cloudIssues: CloudIssue[];
  dependencyIssues: DependencyIssue[];
  tickets: Ticket[];
  coverage: ScanCoverage[];
  ingestRuns: IngestRun[];
}

// ── The modeled view the analysis runs on ────────────────────────────

export interface SourceRef {
  source: 'cloud_scanner' | 'dependency_scanner';
  id: string;
}

export interface Finding {
  key: string;
  assetId: string;
  assetName: string;
  account: string;
  environment: Environment;
  cohort: Cohort;
  service: string | null;
  tier: 1 | 2 | 3;
  team: string | null;
  ownership: Ownership;
  vulnId: string;
  severity: Severity;
  exploit: boolean;
  sources: SourceRef[];
  firstSeen: number;
  /** Periods during which the finding was open. `to` is null while it still is. */
  intervals: { from: number; to: number | null }[];
  /** Why the last interval closed. Accepted risk is a decision, not a fix. */
  closedAs: 'remediated' | 'risk_accepted' | null;
  ticketKey: string | null;
  routedBy: 'automation' | 'manual' | null;
  /** Day it reached a team that could act on it. */
  assignedDay: number | null;
  reassignments: number;
}

export interface ModelQuality {
  recordsIn: { cloud: number; dependency: number };
  rejected: { source: string; id: string; reason: string }[];
  /** Records that turned out to describe a finding another source had already reported. */
  duplicatesMerged: number;
  unreconciledAssets: number;
  assetsTotal: number;
}

export interface Model {
  findings: Finding[];
  quality: ModelQuality;
  sources: Sources;
}
