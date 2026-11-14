import type { Assurance, AssessmentReport, Decision, FingerprintReport, PolicyDocument, ProviderStatus, RecognitionStatus, SignalStatus } from '@portfolio/contracts';

export interface AssessmentRecord {
  id: string;
  requestId: string;
  createdAt: Date;
  policyVersion: string;
  decision: Decision;
  assurance: Assurance;
  reasonCodes: string[];
  /** Redacted before it gets here. */
  report: AssessmentReport;
  ipHmac: string | null;
  ipPrefix: string | null;
  asn: string | null;
  asOrg: string | null;
  country: string | null;
  browserFamily: string;
  browserMajor: string | null;
  osFamily: string;
  botStatus: string;
  sessionContinuity: string;
  totalMs: number;
  signalStatus: Record<string, SignalStatus>;
  orgName: string | null;
  orgType: string | null;
  maxEnrichmentAgeSeconds: number | null;
}

export interface FingerprintRecord {
  assessmentId: string;
  createdAt: Date;
  cookieHash: string | null;
  libraryHash: string;
  canvasHash: string | null;
  webglHash: string | null;
  audioHash: string | null;
  ipPrefix: string | null;
  asn: string | null;
  browserFamily: string;
  osFamily: string;
  recognition: RecognitionStatus;
  report: FingerprintReport;
}

export interface ProviderCallRecord {
  assessmentId: string;
  createdAt: Date;
  provider: string;
  status: ProviderStatus;
  latencyMs: number;
  ageSeconds: number | null;
  detail: string | null;
}

export interface SessionRecord {
  id: string;
  assessmentId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  uaHash: string;
}

export type EventType =
  | 'rate_limited'
  | 'challenge_failed'
  | 'session_rejected'
  | 'origin_rejected'
  | 'admin_login_failed'
  | 'admin_login'
  | 'assessment_error';

export interface EventRecord {
  createdAt: Date;
  type: EventType;
  requestId: string;
  ipHmac: string | null;
  detail: string | null;
}

export interface InvestigationRecord {
  assessmentId: string;
  status: 'open' | 'closed';
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurgeResult {
  assessments: number;
  events: number;
  sessions: number;
}

/**
 * Everything the service needs from durable storage. Two implementations:
 * Postgres for real deployments, and an in-memory one for tests and for
 * running locally without a database.
 */
export interface Store {
  readonly kind: 'postgres' | 'memory';
  ping(): Promise<void>;
  recordPolicyVersion(document: PolicyDocument): Promise<void>;
  saveAssessment(record: AssessmentRecord, calls: ProviderCallRecord[]): Promise<void>;
  getAssessment(id: string): Promise<AssessmentRecord | null>;
  listAssessmentsSince(since: Date): Promise<AssessmentRecord[]>;
  listProviderCallsSince(since: Date): Promise<ProviderCallRecord[]>;
  saveFingerprint(record: FingerprintRecord): Promise<void>;
  getFingerprint(assessmentId: string): Promise<FingerprintRecord | null>;
  /** Earlier fingerprints sharing a cookie, a library hash or a canvas hash with this one. */
  findRelatedFingerprints(keys: { cookieHash: string | null; libraryHash: string; canvasHash: string | null }, before: Date): Promise<FingerprintRecord[]>;
  listFingerprintsSince(since: Date): Promise<FingerprintRecord[]>;
  /** Withdrawal of consent: remove the stored fingerprint for one assessment. */
  deleteFingerprint(assessmentId: string): Promise<void>;
  countDistinctFingerprints(): Promise<number>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  revokeSession(id: string, at: Date): Promise<void>;
  recordEvent(event: EventRecord): Promise<void>;
  listEventsSince(since: Date): Promise<EventRecord[]>;
  upsertInvestigation(investigation: InvestigationRecord): Promise<void>;
  listInvestigations(): Promise<InvestigationRecord[]>;
  /** Retention: delete everything older than the cutoff. */
  purgeOlderThan(cutoff: Date): Promise<PurgeResult>;
  close(): Promise<void>;
}
