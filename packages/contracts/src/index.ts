/**
 * Types shared by the API and the web app.
 *
 * The vocabulary here is deliberate. A "signal" is one piece of evidence,
 * and it always carries where it came from and how far it can be trusted.
 * Nothing in the system is allowed to turn "we could not find out" into
 * "we checked and it is fine".
 */

/** How a signal's value was obtained. */
export type SignalStatus =
  /** Seen directly by our server on the connection or request. */
  | 'observed'
  /** Computed by us from observed values. */
  | 'derived'
  /** Returned by a third-party provider. Evidence, not ground truth. */
  | 'enriched'
  /** Reported by the visitor's browser. Trivially forgeable. */
  | 'claimed'
  /** We tried and there was nothing to learn. */
  | 'unavailable'
  /** The integration that would supply this has no credentials. */
  | 'unconfigured'
  /** The provider failed or timed out. */
  | 'error'
  /** Not collected because the visitor did not opt in. */
  | 'not_consented'
  /** Cannot be measured by a public website at all. */
  | 'not_measurable';

export type Reliability = 'high' | 'medium' | 'low' | 'none';

export type SignalCategory = 'network' | 'browser' | 'automation' | 'session' | 'identity' | 'device';

export type SignalValue = string | number | boolean | null;

/** How the evidence reached us. */
export type CollectionMethod =
  /** Arrived with the connection or the HTTP request. No script, no consent prompt, no way to opt out. */
  | 'connection'
  /** Read by JavaScript running in the page. */
  | 'script'
  /** Looked up from a third party, keyed on something we observed. */
  | 'enrichment'
  /** Worked out by us from other signals. */
  | 'derived'
  /** Not collected. */
  | 'none';

/** What sort of statement the value is. */
export type SignalKind =
  /** Something we saw. */
  | 'fact'
  /** Something the browser told us about itself. */
  | 'claim'
  /** A label a provider or rule assigned. */
  | 'classification'
  /** A conclusion drawn from evidence. Could be wrong. */
  | 'inference'
  /** Something we do not know. */
  | 'gap';

export interface Signal {
  key: string;
  label: string;
  category: SignalCategory;
  value: SignalValue;
  status: SignalStatus;
  reliability: Reliability;
  /** Who said so: "request", "ipinfo", "torproject", "browser", ... */
  source: string;
  method: CollectionMethod;
  kind: SignalKind;
  /** Plain description of how the value was obtained. */
  how?: string;
  /** For enriched data: how old the provider's answer was when it was used. */
  ageSeconds?: number;
  /** The limitation worth knowing: how it can be wrong, spoofed or misread. */
  note?: string;
}

export type Decision = 'ALLOW' | 'CHALLENGE' | 'DENY';

/**
 * How much the decision is worth.
 * `reduced` means it was made without evidence the policy would normally
 * have, for example because a provider was down or not configured.
 */
export type Assurance = 'standard' | 'reduced';

export interface PolicyReason {
  code: string;
  /** NOTE reasons are recorded but did not change the outcome. */
  effect: Decision | 'NOTE';
  summary: string;
  /** Keys of the signals this reason rests on. */
  evidence: string[];
}

export interface RuleEvaluation {
  code: string;
  effect: Decision;
  description: string;
  outcome: 'matched' | 'not_matched' | 'not_evaluable';
}

export type ProviderStatus = 'ok' | 'cache' | 'timeout' | 'error' | 'unconfigured' | 'skipped';

export interface ProviderResult {
  provider: string;
  purpose: string;
  status: ProviderStatus;
  latencyMs: number;
  /** Age of the data used, for cached or periodically refreshed sources. */
  ageSeconds?: number;
  detail?: string;
}

export interface StageTiming {
  stage: 'request' | 'network' | 'browser' | 'automation' | 'session' | 'policy';
  label: string;
  status: 'ok' | 'degraded' | 'failed';
  /** Measured on the server. Not padded, not animated. */
  ms: number;
  detail: string;
}

export interface AssessmentReport {
  id: string;
  requestId: string;
  createdAt: string;
  policyVersion: string;
  decision: Decision;
  assurance: Assurance;
  explanation: string;
  reasons: PolicyReason[];
  rules: RuleEvaluation[];
  signals: Signal[];
  providers: ProviderResult[];
  stages: StageTiming[];
  limitations: string[];
  totalMs: number;
  session?: { expiresAt: string };
  /** Present once the visitor has opted in to the fingerprint. */
  fingerprint?: FingerprintReport;
}

/** What the browser sends. Every field is a claim and is treated as one. */
export interface ClientEvidence {
  userAgent?: string;
  secureContext?: boolean;
  cookiesEnabled?: boolean;
  webdriver?: boolean;
  languages?: string[];
  uaData?: { platform?: string; mobile?: boolean; brands?: string[] };
  capabilities?: { webCrypto?: boolean; webAuthn?: boolean; serviceWorker?: boolean };
}

export interface AssessmentRequest {
  client?: ClientEvidence;
  botToken?: string;
}

export interface AssessmentResponse {
  report: AssessmentReport;
  admitted: boolean;
}

// ── Opt-in fingerprint and recognition ────────────────────────────────

/** Everything the in-page collectors gathered. Sent only after the visitor opts in. */
export interface FingerprintSubmission {
  /** Hash produced by the open-source fingerprinting library. */
  libraryHash: string;
  libraryVersion?: string;
  canvasHash?: string;
  webglHash?: string;
  audioHash?: string;
  fontsHash?: string;
  fontCount?: number;
  webglVendor?: string;
  webglRenderer?: string;
  timezone?: string;
  languages?: string[];
  platform?: string;
  screen?: { width?: number; height?: number; pixelRatio?: number; colorDepth?: number };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  prefersDark?: boolean;
  prefersReducedMotion?: boolean;
  colorGamut?: string;
  pdfViewer?: boolean;
  connectionType?: string;
  mediaDevices?: { audioInputs: number; videoInputs: number; audioOutputs: number };
  permissions?: Record<string, string>;
  storage?: { localStorage?: boolean; indexedDb?: boolean; quotaMb?: number };
  /** Host of the page that linked here, if the browser disclosed one. */
  referrerHost?: string;
  /** Collectors that failed or were blocked, by name. */
  blocked?: string[];
}

export interface Inconsistency {
  key: string;
  title: string;
  clientSays: string;
  serverSees: string;
  /** What usually explains it. Never treated as proof of anything. */
  reading: string;
}

export type RecognitionStatus = 'recognized' | 'probable' | 'possible' | 'similar' | 'new';

export interface Recognition {
  status: RecognitionStatus;
  confidence: 'high' | 'medium' | 'low' | 'none';
  headline: string;
  /** What supports the association, and what argues against it. */
  evidence: { supports: boolean; text: string }[];
  priorVisits: number;
  firstSeen: string | null;
  caveat: string;
}

export interface FingerprintReport {
  collectedAt: string;
  signals: Signal[];
  inconsistencies: Inconsistency[];
  recognition: Recognition;
  /** How many distinct fingerprints we hold, for context on uniqueness. Not a population statistic. */
  fingerprintsOnFile: number;
}

export interface GateConfig {
  environment: string;
  policyVersion: string;
  sessionTtlMinutes: number;
  retentionDays: number;
  botVerification: { provider: 'turnstile'; configured: boolean; siteKey?: string };
  /**
   * Company-level visit analytics, run by a third party in the visitor's browser after admission.
   * `cookieless`: visitors who have not chosen are measured without cookies or stored identifiers.
   * The write key is a public identifier (it ships in the page), not a secret.
   */
  visitorAnalytics: { provider: 'dreamdata'; configured: boolean; writeKey?: string; cookieless: boolean };
  providers: { name: string; purpose: string; configured: boolean; note: string }[];
}

export interface PolicyDocument {
  version: string;
  summary: string;
  thresholds: Record<string, number>;
  rules: { code: string; effect: Decision; description: string; rationale: string }[];
  notPenalized: string[];
  failurePolicy: string[];
}

// ── Admin analytics ───────────────────────────────────────────────────

export interface Distribution {
  key: string;
  count: number;
}

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ProviderHealth {
  provider: string;
  calls: number;
  ok: number;
  cache: number;
  timeout: number;
  error: number;
  unconfigured: number;
  /** Deliberately not called: private address, rate-limited client, or daily budget spent. */
  skipped: number;
  /** Failures as a share of attempts that actually reached the provider. */
  failureRate: number | null;
  latency: LatencySummary;
  maxAgeSeconds: number | null;
}

export interface HealthFinding {
  severity: 'ok' | 'watch' | 'action';
  title: string;
  detail: string;
}

export interface AdminOverview {
  generatedAt: string;
  windowDays: number;
  total: number;
  decisions: Distribution[];
  assurance: Distribution[];
  daily: { day: string; allow: number; challenge: number; deny: number }[];
  botOutcomes: Distribution[];
  policyVersions: Distribution[];
  sessionContinuity: Distribution[];
  latency: LatencySummary;
  providers: ProviderHealth[];
  signalAvailability: { key: string; label: string; total: number; usable: number; rate: number }[];
  browserImpact: { browser: string; total: number; nonAllow: number; rate: number }[];
  events: Distribution[];
  /** Decisions made with standard assurance although a provider failed. Must be zero. */
  misclassifiedFailures: number;
  staleEnrichmentDecisions: number;
  investigations: { open: number; total: number };
  /** Share of admitted visitors who opted in to the fingerprint. */
  fingerprintOptIn: { admitted: number; optedIn: number };
  recognition: Distribution[];
  /** Organization-level attribution only. Never individuals. */
  organizations: { name: string; type: string; visits: number; lastSeen: string }[];
  findings: HealthFinding[];
}

export interface AdminAssessmentRow {
  id: string;
  createdAt: string;
  decision: Decision;
  assurance: Assurance;
  policyVersion: string;
  reasonCodes: string[];
  network: string;
  organization: string | null;
  country: string | null;
  browser: string;
  botStatus: string;
  totalMs: number;
  investigation: { status: 'open' | 'closed'; note: string } | null;
}

// ── Public gateway health ─────────────────────────────────────────────

/**
 * What anyone may see about the gateway: aggregates only.
 *
 * With little traffic even an aggregate can describe one person ("one
 * evaluation today, challenged"). So nothing about outcomes is published
 * until the window holds a minimum number of evaluations, and counts are
 * rounded down. Nothing here is broken out by network, organization,
 * browser or time of day.
 */
export interface PublicHealth {
  generatedAt: string;
  windowDays: number;
  policyVersion: string;
  /** False when there are too few evaluations to publish outcome figures. */
  sufficient: boolean;
  minimumToPublish: number;
  /** Rounded down to the nearest ten. Null when not sufficient. */
  evaluations: number | null;
  /** Whole percentages. Null when not sufficient. */
  decisions: { allow: number; challenge: number; deny: number } | null;
  standardAssurance: number | null;
  latency: { p50: number; p95: number } | null;
  /** Provider failures recorded as full-assurance decisions. Should always be zero. */
  failuresCountedAsPasses: number | null;
  providers: { name: string; state: 'healthy' | 'degraded' | 'no_live_calls' | 'not_configured' }[];
}
