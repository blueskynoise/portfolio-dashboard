import type {
  AssessmentRecord,
  EventRecord,
  FingerprintRecord,
  InvestigationRecord,
  ProviderCallRecord,
  PurgeResult,
  SessionRecord,
  Store,
} from './types';

/** Non-durable store for tests and for local runs without a database. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  assessments = new Map<string, AssessmentRecord>();
  calls: ProviderCallRecord[] = [];
  sessions = new Map<string, SessionRecord>();
  events: EventRecord[] = [];
  investigations = new Map<string, InvestigationRecord>();
  fingerprints = new Map<string, FingerprintRecord>();
  policyVersions = new Set<string>();
  /** Test hook: make the next writes fail, as a database outage would. */
  failWrites = false;

  async ping(): Promise<void> {}

  async recordPolicyVersion(document: { version: string }): Promise<void> {
    this.policyVersions.add(document.version);
  }

  async saveAssessment(record: AssessmentRecord, calls: ProviderCallRecord[]): Promise<void> {
    if (this.failWrites) throw new Error('store unavailable');
    this.assessments.set(record.id, structuredClone(record));
    this.calls.push(...calls);
  }

  async getAssessment(id: string): Promise<AssessmentRecord | null> {
    const record = this.assessments.get(id);
    return record ? structuredClone(record) : null;
  }

  async listAssessmentsSince(since: Date): Promise<AssessmentRecord[]> {
    return [...this.assessments.values()].filter((a) => a.createdAt >= since).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listProviderCallsSince(since: Date): Promise<ProviderCallRecord[]> {
    return this.calls.filter((c) => c.createdAt >= since);
  }

  async saveFingerprint(record: FingerprintRecord): Promise<void> {
    if (this.failWrites) throw new Error('store unavailable');
    this.fingerprints.set(record.assessmentId, structuredClone(record));
  }

  async getFingerprint(assessmentId: string): Promise<FingerprintRecord | null> {
    const record = this.fingerprints.get(assessmentId);
    return record ? structuredClone(record) : null;
  }

  async findRelatedFingerprints(keys: { cookieHash: string | null; libraryHash: string; canvasHash: string | null }, before: Date): Promise<FingerprintRecord[]> {
    return [...this.fingerprints.values()]
      .filter(
        (f) =>
          f.createdAt < before &&
          ((keys.cookieHash !== null && f.cookieHash === keys.cookieHash) ||
            f.libraryHash === keys.libraryHash ||
            (keys.canvasHash !== null && f.canvasHash === keys.canvasHash)),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async listFingerprintsSince(since: Date): Promise<FingerprintRecord[]> {
    return [...this.fingerprints.values()].filter((f) => f.createdAt >= since);
  }

  async deleteFingerprint(assessmentId: string): Promise<void> {
    this.fingerprints.delete(assessmentId);
  }

  async countDistinctFingerprints(): Promise<number> {
    return new Set([...this.fingerprints.values()].map((f) => f.libraryHash)).size;
  }

  async createSession(session: SessionRecord): Promise<void> {
    if (this.failWrites) throw new Error('store unavailable');
    this.sessions.set(session.id, { ...session });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = at;
  }

  async recordEvent(event: EventRecord): Promise<void> {
    this.events.push(event);
  }

  async listEventsSince(since: Date): Promise<EventRecord[]> {
    return this.events.filter((e) => e.createdAt >= since);
  }

  async upsertInvestigation(investigation: InvestigationRecord): Promise<void> {
    const existing = this.investigations.get(investigation.assessmentId);
    this.investigations.set(investigation.assessmentId, { ...investigation, createdAt: existing?.createdAt ?? investigation.createdAt });
  }

  async listInvestigations(): Promise<InvestigationRecord[]> {
    return [...this.investigations.values()];
  }

  async purgeOlderThan(cutoff: Date): Promise<PurgeResult> {
    const result: PurgeResult = { assessments: 0, events: 0, sessions: 0 };
    for (const [id, record] of this.assessments) {
      if (record.createdAt >= cutoff) continue;
      this.assessments.delete(id);
      this.investigations.delete(id);
      this.fingerprints.delete(id);
      result.assessments++;
      for (const [sid, session] of this.sessions) {
        if (session.assessmentId === id) {
          this.sessions.delete(sid);
          result.sessions++;
        }
      }
    }
    this.calls = this.calls.filter((c) => this.assessments.has(c.assessmentId));
    const before = this.events.length;
    this.events = this.events.filter((e) => e.createdAt >= cutoff);
    result.events = before - this.events.length;
    return result;
  }

  async close(): Promise<void> {}
}
