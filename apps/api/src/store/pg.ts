import pg from 'pg';
import type { PolicyDocument } from '@portfolio/contracts';
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

type Row = Record<string, unknown>;

const toAssessment = (row: Row): AssessmentRecord => ({
  id: row.id as string,
  requestId: row.request_id as string,
  createdAt: row.created_at as Date,
  policyVersion: row.policy_version as string,
  decision: row.decision as AssessmentRecord['decision'],
  assurance: row.assurance as AssessmentRecord['assurance'],
  reasonCodes: row.reason_codes as string[],
  report: row.report as AssessmentRecord['report'],
  ipHmac: row.ip_hmac as string | null,
  ipPrefix: row.ip_prefix as string | null,
  asn: row.asn as string | null,
  asOrg: row.as_org as string | null,
  country: row.country as string | null,
  browserFamily: row.browser_family as string,
  browserMajor: row.browser_major as string | null,
  osFamily: row.os_family as string,
  botStatus: row.bot_status as string,
  sessionContinuity: row.session_continuity as string,
  totalMs: row.total_ms as number,
  signalStatus: row.signal_status as AssessmentRecord['signalStatus'],
  orgName: row.org_name as string | null,
  orgType: row.org_type as string | null,
  maxEnrichmentAgeSeconds: row.max_enrichment_age_seconds as number | null,
});

const toFingerprint = (row: Row): FingerprintRecord => ({
  assessmentId: row.assessment_id as string,
  createdAt: row.created_at as Date,
  cookieHash: row.cookie_hash as string | null,
  libraryHash: row.library_hash as string,
  canvasHash: row.canvas_hash as string | null,
  webglHash: row.webgl_hash as string | null,
  audioHash: row.audio_hash as string | null,
  ipPrefix: row.ip_prefix as string | null,
  asn: row.asn as string | null,
  browserFamily: row.browser_family as string,
  osFamily: row.os_family as string,
  recognition: row.recognition as FingerprintRecord['recognition'],
  report: row.report as FingerprintRecord['report'],
});

export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      // Railway's private network does not use TLS; public connection strings carry sslmode themselves.
    });
    // An idle client erroring must not take the process down.
    this.pool.on('error', () => undefined);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async recordPolicyVersion(document: PolicyDocument): Promise<void> {
    await this.pool.query('INSERT INTO policy_versions (version, document) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [
      document.version,
      JSON.stringify(document),
    ]);
  }

  async saveAssessment(r: AssessmentRecord, calls: ProviderCallRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO assessments (id, request_id, created_at, policy_version, decision, assurance, reason_codes, report,
           ip_hmac, ip_prefix, asn, as_org, country, browser_family, browser_major, os_family, bot_status,
           session_continuity, total_ms, signal_status, org_name, org_type, max_enrichment_age_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          r.id, r.requestId, r.createdAt, r.policyVersion, r.decision, r.assurance, r.reasonCodes, JSON.stringify(r.report),
          r.ipHmac, r.ipPrefix, r.asn, r.asOrg, r.country, r.browserFamily, r.browserMajor, r.osFamily, r.botStatus,
          r.sessionContinuity, r.totalMs, JSON.stringify(r.signalStatus), r.orgName, r.orgType, r.maxEnrichmentAgeSeconds,
        ],
      );
      for (const call of calls) {
        await client.query(
          'INSERT INTO provider_calls (assessment_id, created_at, provider, status, latency_ms, age_seconds, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [call.assessmentId, call.createdAt, call.provider, call.status, call.latencyMs, call.ageSeconds, call.detail],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAssessment(id: string): Promise<AssessmentRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM assessments WHERE id = $1', [id]);
    return rows[0] ? toAssessment(rows[0]) : null;
  }

  async listAssessmentsSince(since: Date): Promise<AssessmentRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM assessments WHERE created_at >= $1 ORDER BY created_at', [since]);
    return rows.map(toAssessment);
  }

  async listProviderCallsSince(since: Date): Promise<ProviderCallRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM provider_calls WHERE created_at >= $1', [since]);
    return rows.map((row: Row) => ({
      assessmentId: row.assessment_id as string,
      createdAt: row.created_at as Date,
      provider: row.provider as string,
      status: row.status as ProviderCallRecord['status'],
      latencyMs: row.latency_ms as number,
      ageSeconds: row.age_seconds as number | null,
      detail: row.detail as string | null,
    }));
  }

  async saveFingerprint(f: FingerprintRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO fingerprints (assessment_id, created_at, cookie_hash, library_hash, canvas_hash, webgl_hash, audio_hash,
         ip_prefix, asn, browser_family, os_family, recognition, report)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (assessment_id) DO NOTHING`,
      [f.assessmentId, f.createdAt, f.cookieHash, f.libraryHash, f.canvasHash, f.webglHash, f.audioHash, f.ipPrefix, f.asn, f.browserFamily, f.osFamily, f.recognition, JSON.stringify(f.report)],
    );
  }

  async getFingerprint(assessmentId: string): Promise<FingerprintRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM fingerprints WHERE assessment_id = $1', [assessmentId]);
    return rows[0] ? toFingerprint(rows[0]) : null;
  }

  async findRelatedFingerprints(keys: { cookieHash: string | null; libraryHash: string; canvasHash: string | null }, before: Date): Promise<FingerprintRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM fingerprints
       WHERE created_at < $4 AND (library_hash = $2 OR ($1::text IS NOT NULL AND cookie_hash = $1) OR ($3::text IS NOT NULL AND canvas_hash = $3))
       ORDER BY created_at LIMIT 200`,
      [keys.cookieHash, keys.libraryHash, keys.canvasHash, before],
    );
    return rows.map(toFingerprint);
  }

  async listFingerprintsSince(since: Date): Promise<FingerprintRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM fingerprints WHERE created_at >= $1', [since]);
    return rows.map(toFingerprint);
  }

  async deleteFingerprint(assessmentId: string): Promise<void> {
    await this.pool.query('DELETE FROM fingerprints WHERE assessment_id = $1', [assessmentId]);
  }

  async countDistinctFingerprints(): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(DISTINCT library_hash)::int AS n FROM fingerprints');
    return (rows[0] as { n: number }).n;
  }

  async createSession(s: SessionRecord): Promise<void> {
    await this.pool.query('INSERT INTO sessions (id, assessment_id, created_at, expires_at, revoked_at, ua_hash) VALUES ($1,$2,$3,$4,$5,$6)', [
      s.id, s.assessmentId, s.createdAt, s.expiresAt, s.revokedAt, s.uaHash,
    ]);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    const row = rows[0] as Row | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      assessmentId: row.assessment_id as string,
      createdAt: row.created_at as Date,
      expiresAt: row.expires_at as Date,
      revokedAt: row.revoked_at as Date | null,
      uaHash: row.ua_hash as string,
    };
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.pool.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, at]);
  }

  async recordEvent(e: EventRecord): Promise<void> {
    await this.pool.query('INSERT INTO access_events (created_at, type, request_id, ip_hmac, detail) VALUES ($1,$2,$3,$4,$5)', [
      e.createdAt, e.type, e.requestId, e.ipHmac, e.detail,
    ]);
  }

  async listEventsSince(since: Date): Promise<EventRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM access_events WHERE created_at >= $1', [since]);
    return rows.map((row: Row) => ({
      createdAt: row.created_at as Date,
      type: row.type as EventRecord['type'],
      requestId: row.request_id as string,
      ipHmac: row.ip_hmac as string | null,
      detail: row.detail as string | null,
    }));
  }

  async upsertInvestigation(i: InvestigationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO investigations (assessment_id, status, note, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (assessment_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
      [i.assessmentId, i.status, i.note, i.createdAt, i.updatedAt],
    );
  }

  async listInvestigations(): Promise<InvestigationRecord[]> {
    const { rows } = await this.pool.query('SELECT * FROM investigations');
    return rows.map((row: Row) => ({
      assessmentId: row.assessment_id as string,
      status: row.status as 'open' | 'closed',
      note: row.note as string,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }));
  }

  async purgeOlderThan(cutoff: Date): Promise<PurgeResult> {
    // Sessions, provider calls and investigations go with their assessment (ON DELETE CASCADE).
    const sessions = await this.pool.query('SELECT count(*)::int AS n FROM sessions s JOIN assessments a ON a.id = s.assessment_id WHERE a.created_at < $1', [cutoff]);
    const assessments = await this.pool.query('DELETE FROM assessments WHERE created_at < $1', [cutoff]);
    const events = await this.pool.query('DELETE FROM access_events WHERE created_at < $1', [cutoff]);
    return { assessments: assessments.rowCount ?? 0, events: events.rowCount ?? 0, sessions: (sessions.rows[0] as { n: number }).n };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
