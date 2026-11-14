import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { POLICY_DOCUMENT } from '@portfolio/policy';
import { migrate } from './migrate';
import { PgStore } from './pg';
import type { AssessmentRecord, FingerprintRecord } from './types';

/**
 * Runs against a real Postgres when TEST_DATABASE_URL is set
 * (`npm run test:db`). Skipped otherwise, and CI should treat a skip here
 * as a missing check, not a pass.
 *
 * The suite drops and recreates the schema, so it refuses to touch any
 * database whose name does not end in "_test".
 */
const url = process.env.TEST_DATABASE_URL;
if (url && !/_test$/.test(new URL(url).pathname)) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name ends in "_test": this suite wipes it.');
}
const suite = url ? describe : describe.skip;

suite('PgStore against a real database', () => {
  let store: PgStore;
  const at = (iso: string) => new Date(iso);
  const assessment = (id: string, createdAt: Date, overrides: Partial<AssessmentRecord> = {}): AssessmentRecord => ({
    id, requestId: `req-${id}`, createdAt, policyVersion: POLICY_DOCUMENT.version, decision: 'ALLOW', assurance: 'standard', reasonCodes: ['BASELINE_SATISFIED'],
    report: { id, signals: [{ key: 'network.ip', value: '203.0.113.0/24' }] } as unknown as AssessmentRecord['report'],
    ipHmac: 'hmac', ipPrefix: '203.0.113.0/24', asn: 'AS64500', asOrg: 'Example', country: 'US', browserFamily: 'Chrome', browserMajor: '140', osFamily: 'Windows',
    botStatus: 'passed', sessionContinuity: 'new', totalMs: 123, signalStatus: { 'network.ip': 'observed' }, orgName: 'Example Corp', orgType: 'business', maxEnrichmentAgeSeconds: 12, ...overrides,
  });
  const fingerprint = (assessmentId: string, createdAt: Date, overrides: Partial<FingerprintRecord> = {}): FingerprintRecord => ({
    assessmentId, createdAt, cookieHash: 'cookie', libraryHash: 'lib', canvasHash: 'canvas', webglHash: 'webgl', audioHash: null, ipPrefix: '203.0.113.0/24', asn: 'AS64500', browserFamily: 'Chrome', osFamily: 'Windows', recognition: 'new',
    report: { collectedAt: createdAt.toISOString(), signals: [], inconsistencies: [], recognition: { status: 'new' }, fingerprintsOnFile: 0 } as unknown as FingerprintRecord['report'], ...overrides,
  });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await admin.end();
    const applied = await migrate(url as string, 'db/migrations', () => undefined);
    expect(applied).toEqual(['001_init.sql']);
    // Running again is a no-op.
    expect(await migrate(url as string, 'db/migrations', () => undefined)).toEqual([]);
    store = new PgStore(url as string);
  });
  afterAll(async () => {
    await store?.close();
  });

  it('round-trips an assessment with its provider calls, atomically', async () => {
    const record = assessment('a1', at('2026-11-10T10:00:00Z'));
    await store.saveAssessment(record, [{ assessmentId: 'a1', createdAt: record.createdAt, provider: 'ipapi.is', status: 'ok', latencyMs: 80, ageSeconds: 0, detail: null }]);
    expect(await store.getAssessment('a1')).toEqual(record);
    expect(await store.listProviderCallsSince(at('2026-11-01T00:00:00Z'))).toHaveLength(1);

    // A duplicate id fails as a whole: no orphaned provider calls.
    await expect(store.saveAssessment(record, [{ assessmentId: 'a1', createdAt: record.createdAt, provider: 'x', status: 'ok', latencyMs: 1, ageSeconds: null, detail: null }])).rejects.toThrow();
    expect(await store.listProviderCallsSince(at('2026-11-01T00:00:00Z'))).toHaveLength(1);
  });

  it('rejects values outside the decision vocabulary', async () => {
    await expect(store.saveAssessment(assessment('bad', at('2026-11-10T10:00:00Z'), { decision: 'MAYBE' as never }), [])).rejects.toThrow();
  });

  it('stores, revokes and reads sessions', async () => {
    const session = { id: 's1', assessmentId: 'a1', createdAt: at('2026-11-10T10:00:00Z'), expiresAt: at('2026-11-10T18:00:00Z'), revokedAt: null, uaHash: 'ua' };
    await store.createSession(session);
    expect(await store.getSession('s1')).toEqual(session);
    await store.revokeSession('s1', at('2026-11-10T11:00:00Z'));
    expect((await store.getSession('s1'))?.revokedAt).toEqual(at('2026-11-10T11:00:00Z'));
    expect(await store.getSession('nope')).toBeNull();
  });

  it('finds related fingerprints by cookie, library hash or canvas, and only earlier ones', async () => {
    await store.saveAssessment(assessment('a2', at('2026-11-11T10:00:00Z')), []);
    await store.saveAssessment(assessment('a3', at('2026-11-12T10:00:00Z')), []);
    await store.saveFingerprint(fingerprint('a1', at('2026-11-10T10:00:00Z')));
    await store.saveFingerprint(fingerprint('a2', at('2026-11-11T10:00:00Z'), { cookieHash: 'other', libraryHash: 'other-lib', canvasHash: 'canvas' }));
    await store.saveFingerprint(fingerprint('a3', at('2026-11-12T10:00:00Z'), { cookieHash: 'unrelated', libraryHash: 'unrelated', canvasHash: 'unrelated' }));

    const related = await store.findRelatedFingerprints({ cookieHash: 'cookie', libraryHash: 'nothing', canvasHash: 'canvas' }, at('2026-11-13T00:00:00Z'));
    expect(related.map((f) => f.assessmentId)).toEqual(['a1', 'a2']);
    expect(await store.findRelatedFingerprints({ cookieHash: null, libraryHash: 'lib', canvasHash: null }, at('2026-11-10T10:00:00Z'))).toEqual([]);
    expect(await store.countDistinctFingerprints()).toBe(3);
    await store.deleteFingerprint('a3');
    expect(await store.getFingerprint('a3')).toBeNull();
  });

  it('records events, investigations and policy versions', async () => {
    await store.recordPolicyVersion(POLICY_DOCUMENT);
    await store.recordPolicyVersion(POLICY_DOCUMENT);
    await store.recordEvent({ createdAt: at('2026-11-10T10:00:00Z'), type: 'challenge_failed', requestId: 'r', ipHmac: 'h', detail: 'x' });
    expect(await store.listEventsSince(at('2026-11-01T00:00:00Z'))).toHaveLength(1);
    const now = at('2026-11-12T00:00:00Z');
    await store.upsertInvestigation({ assessmentId: 'a1', status: 'open', note: 'first', createdAt: now, updatedAt: now });
    await store.upsertInvestigation({ assessmentId: 'a1', status: 'closed', note: 'second', createdAt: now, updatedAt: now });
    expect(await store.listInvestigations()).toMatchObject([{ assessmentId: 'a1', status: 'closed', note: 'second' }]);
  });

  it('retention removes old assessments and everything hanging off them', async () => {
    const purged = await store.purgeOlderThan(at('2026-11-11T00:00:00Z'));
    expect(purged).toMatchObject({ assessments: 1, events: 1, sessions: 1 });
    expect(await store.getAssessment('a1')).toBeNull();
    expect(await store.getSession('s1')).toBeNull();
    expect(await store.getFingerprint('a1')).toBeNull();
    expect(await store.listInvestigations()).toEqual([]);
    expect(await store.listProviderCallsSince(at('2026-01-01T00:00:00Z'))).toEqual([]);
    expect((await store.listAssessmentsSince(at('2026-01-01T00:00:00Z'))).map((a) => a.id)).toEqual(['a2', 'a3']);
  });
});
