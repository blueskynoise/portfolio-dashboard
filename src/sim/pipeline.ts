import { findingKey } from './identity';
import { normalize } from './normalize';
import { buildActions, type AssessedFinding, type RemediationAction } from './remediation';
import { assessRisk, type RiskBand } from './risk';
import { forkRng } from './rng';
import { SourceSimulator } from './sources';
import { FindingStore } from './store';
import { DEFAULT_RETRY, fetchWithRetry, type FetchOutcome } from './transport';
import {
  CAREFUL_POLICY,
  CYCLES,
  STAGE_ORDER,
  type DecisionCode,
  type FaultConfig,
  type Finding,
  type Observation,
  type Policy,
  type RawRecord,
  type SourceId,
  type StageId,
  type StageReport,
  type World,
} from './types';
import { verifyAgainstTruth, type Verification } from './verify';
import { generateWorld } from './world';

/**
 * The pipeline.
 *
 * `runSimulation` is a pure function: the same config always produces the
 * same result, with no timers, network or randomness beyond the seed. The
 * UI replays the returned reports; it never computes numbers of its own.
 */

export interface SimConfig {
  seed: number;
  alertCount: number;
  faults: FaultConfig;
}

export interface TransportReport {
  requests: number;
  rateLimited: number;
  serverErrors: number;
  failedPages: number;
  /** Simulated time spent waiting between retries. */
  waitedMs: number;
}

export interface SyncReport {
  harbor: {
    scanId: string;
    pagesTotal: number;
    pagesRetrieved: number;
    hostsTargeted: number;
    hostsUnreachable: number;
    complete: boolean;
  };
  lantern: { cursorBefore: number; cursorAfter: number; pages: number; complete: boolean };
  sieve: { deliveries: number };
}

export interface CycleReport {
  cycle: number;
  stages: Record<StageId, StageReport>;
  transport: TransportReport;
  sync: SyncReport;
  snapshot: { total: number; open: number; pending: number; resolved: number };
  bands: Record<RiskBand, number>;
  actions: number;
  verification: Verification;
}

export interface Funnel {
  received: number;
  afterDedupe: number;
  uniqueFindings: number;
  stillOpen: number;
  actNow: number;
  actions: number;
}

export interface SimulationResult {
  config: SimConfig;
  policy: Policy;
  world: World;
  cycles: CycleReport[];
  /** Every finding the pipeline knows about at the end, with its risk context. */
  findings: AssessedFinding[];
  actions: RemediationAction[];
  funnel: Funnel;
  /** Findings that were closed at the end of some cycle while they really still existed. */
  everWronglyClosed: string[];
}

const SAMPLES_PER_CODE = 4;
const VERSION_WORD: Record<SourceId, string> = { harbor: 'scan', lantern: 'rev', sieve: 'seq' };
/** Decisions worth keeping on a finding's own timeline. */
const HISTORY_CODES = new Set<DecisionCode>([
  'created', 'source_linked', 'fixed_by_source', 'reopened', 'stale_ignored', 'reappeared',
  'absence_pending', 'absence_confirmed', 'held_incomplete_scan', 'held_asset_not_scanned', 'drift_repaired',
]);

function emptyStage(id: StageId): StageReport {
  return { id, in: 0, out: 0, counters: {}, samples: [] };
}

export function runSimulation(config: SimConfig, policy: Policy = CAREFUL_POLICY): SimulationResult {
  const world = generateWorld(config.seed, config.alertCount);
  const sim = new SourceSimulator(world, config.faults);
  const store = new FindingStore();
  const seenKeys = new Set<string>();
  const lanternRefs = new Map<string, string>();
  const jitter = forkRng(config.seed, 'retry-jitter');
  const assetById = new Map(world.assets.map((a) => [a.id, a]));
  const vulnById = new Map(world.vulns.map((v) => [v.id, v]));
  const everWronglyClosed = new Set<string>();
  let lanternCursor = 0;
  const cycles: CycleReport[] = [];

  const assess = (findings: Finding[]): AssessedFinding[] => {
    const assessed: AssessedFinding[] = [];
    for (const finding of findings) {
      const asset = assetById.get(finding.assetId);
      const vuln = vulnById.get(finding.vulnId);
      // A finding we cannot enrich is left out of ranking rather than guessed at.
      if (asset && vuln) assessed.push({ finding, asset, vuln, risk: assessRisk(vuln, asset) });
    }
    return assessed;
  };

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const stages = Object.fromEntries(STAGE_ORDER.map((id) => [id, emptyStage(id)])) as Record<StageId, StageReport>;
    const transport: TransportReport = { requests: 0, rateLimited: 0, serverErrors: 0, failedPages: 0, waitedMs: 0 };

    const note = (stage: StageId, code: DecisionCode, text?: string, finding?: Finding, source?: SourceId): void => {
      const report = stages[stage];
      report.counters[code] = (report.counters[code] ?? 0) + 1;
      if (!text) return;
      if (finding && HISTORY_CODES.has(code)) finding.history.push({ cycle, code, source, detail: text });
      const shown = report.samples.filter((s) => s.code === code).length;
      if (shown < SAMPLES_PER_CODE) {
        report.samples.push({
          code,
          text: finding ? `${finding.assetId} · ${finding.vulnId}: ${text}` : text,
          findingKey: finding?.key,
        });
      }
    };

    const account = <T>(outcome: FetchOutcome<T>, label: string): void => {
      transport.requests += outcome.attempts.length;
      transport.waitedMs += outcome.waitedMs;
      for (const attempt of outcome.attempts) {
        if (attempt.status === 429) {
          transport.rateLimited++;
          note('ingest', 'retry_429', `${label}: HTTP 429, waited ${(attempt.waitMs / 1000).toFixed(1)}s as instructed (attempt ${attempt.attempt})`);
        } else if (attempt.status === 503) {
          transport.serverErrors++;
          note('ingest', 'retry_503', `${label}: HTTP 503 on attempt ${attempt.attempt}${attempt.waitMs ? `, backed off ${(attempt.waitMs / 1000).toFixed(1)}s` : ', out of attempts'}`);
        }
      }
      if (outcome.ok) note('ingest', 'page_ok');
      else {
        transport.failedPages++;
        note('ingest', 'page_failed', `${label}: gave up after ${outcome.attempts.length} attempts. Recorded as missing, not as empty.`);
      }
    };

    // ── 1. Ingest ─────────────────────────────────────────────────────
    const received: RawRecord[] = [];

    const summary = sim.harborSummary(cycle);
    let harborPagesRetrieved = 0;
    for (let page = 0; page < summary.total_pages; page++) {
      const outcome = fetchWithRetry((attempt) => sim.harborPage(cycle, page, attempt), DEFAULT_RETRY, jitter);
      account(outcome, `harbor ${summary.scan_id} page ${page + 1}/${summary.total_pages}`);
      if (!outcome.ok || !outcome.body) continue;
      harborPagesRetrieved++;
      for (const raw of outcome.body) received.push({ source: 'harbor', raw });
    }
    const harborComplete = summary.status === 'completed' && harborPagesRetrieved === summary.total_pages;

    const cursorBefore = lanternCursor;
    let lanternPages = 0;
    let lanternComplete = true;
    for (let pageIndex = 0; ; pageIndex++) {
      const cursor = lanternCursor;
      const outcome = fetchWithRetry((attempt) => sim.lanternChanges(cursor, cycle, pageIndex, attempt), DEFAULT_RETRY, jitter);
      account(outcome, `lantern changes after cursor ${cursor}`);
      if (!outcome.ok || !outcome.body) {
        lanternComplete = false;
        break;
      }
      lanternPages++;
      for (const raw of outcome.body.records) received.push({ source: 'lantern', raw });
      // The cursor only ever moves past pages we actually hold.
      lanternCursor = outcome.body.next_cursor;
      if (!outcome.body.has_more) break;
    }
    if (lanternComplete) note('ingest', 'cursor_advanced', `lantern cursor ${cursorBefore} → ${lanternCursor}`);
    else note('ingest', 'cursor_held', `lantern cursor held at ${lanternCursor}. The next sync resumes from here.`);

    const deliveries = sim.sieveDeliveries(cycle);
    for (const raw of deliveries) received.push({ source: 'sieve', raw });

    stages.ingest.in = transport.requests;
    stages.ingest.out = received.length;

    // ── 2. Normalize ──────────────────────────────────────────────────
    const observations: Observation[] = [];
    for (const record of received) {
      const result = normalize(record);
      if (result.ok) {
        observations.push(result.observation);
        note('normalize', 'normalized');
      } else note('normalize', 'rejected', result.reason);
    }
    stages.normalize.in = received.length;
    stages.normalize.out = observations.length;

    // ── 3. Deduplicate ────────────────────────────────────────────────
    const fresh: Observation[] = [];
    for (const observation of observations) {
      if (policy.idempotentDedupe && seenKeys.has(observation.dedupeKey)) {
        note('dedupe', 'duplicate_dropped', `${observation.source} delivered ${observation.dedupeKey.split(':').slice(1).join(':')} again. Dropped.`);
        continue;
      }
      seenKeys.add(observation.dedupeKey);
      fresh.push(observation);
    }
    stages.dedupe.in = observations.length;
    stages.dedupe.out = fresh.length;

    // ── 4. Identity and state ─────────────────────────────────────────
    const touched = new Set<string>();
    const applyObservation = (observation: Observation): void => {
      const before = store.get(findingKey(observation.assetId, observation.vulnId))?.obs[observation.source]?.version;
      const { code, finding } = store.apply(observation, cycle, policy);
      if (observation.source === 'lantern') lanternRefs.set(observation.sourceRef, finding.key);
      const word = VERSION_WORD[observation.source];
      const text: Partial<Record<DecisionCode, string>> = {
        created: `first reported by ${observation.source}`,
        source_linked: `${observation.source} reports the same problem. Linked to the existing finding instead of creating another.`,
        fixed_by_source: `${observation.source} says fixed (${word} ${observation.version})`,
        reopened: `${observation.source} reports it again (${word} ${observation.version}) after it was closed. Re-opened.`,
        reappeared: `back in ${word} ${observation.version} before the absence was confirmed. Still open, as it turns out.`,
        stale_ignored: `${observation.source} ${word} ${observation.version} arrived after ${word} ${before}. Older than what we have, so ignored.`,
      };
      note('identity', code, text[code], finding, observation.source);
      touched.add(finding.key);
    };
    for (const observation of fresh) applyObservation(observation);
    stages.identity.in = fresh.length;
    stages.identity.out = touched.size;

    // ── 5. Reconcile ──────────────────────────────────────────────────
    const unreachable = new Set(summary.unreachable_hosts);
    store.reconcileSnapshot(
      {
        source: 'harbor',
        cycle,
        complete: harborComplete,
        scannedAssets: new Set(summary.targeted_hosts.filter((host) => !unreachable.has(host))),
      },
      policy,
      (code, finding, obs) => {
        const text = {
          absence_pending: `missing from ${summary.scan_id}, which was complete and reached the asset. Waiting for a second scan before closing.`,
          absence_confirmed: `missing from ${obs.missed} qualifying scan${obs.missed === 1 ? '' : 's'} in a row. Closed.`,
          held_incomplete_scan: `not in ${summary.scan_id}, but that scan is missing pages. Absence proves nothing; state held.`,
          held_asset_not_scanned: `not in ${summary.scan_id}, but the scanner never reached this asset. State held.`,
        }[code];
        note('reconcile', code, text, finding, 'harbor');
      },
    );

    if (policy.inventorySweep) {
      for (const entry of sim.lanternInventory(cycle)) {
        const key = lanternRefs.get(entry.finding_uid);
        const localRev = key ? (store.get(key)?.obs.lantern?.version ?? 0) : 0;
        if (localRev >= entry.rev) continue;
        const raw = sim.lanternGet(entry.finding_uid, cycle);
        if (!raw) continue;
        const result = normalize({ source: 'lantern', raw });
        if (!result.ok) continue;
        seenKeys.add(result.observation.dedupeKey);
        const { finding } = store.apply(result.observation, cycle, policy);
        lanternRefs.set(entry.finding_uid, finding.key);
        note(
          'reconcile',
          'drift_repaired',
          `inventory shows rev ${entry.rev}, we had ${localRev === 0 ? 'nothing' : `rev ${localRev}`}. Fetched the record: lantern says ${result.observation.status}.`,
          finding,
          'lantern',
        );
      }
    }

    const all = store.all();
    for (const finding of all) finding.statusByCycle[cycle - 1] = finding.status;
    const open = all.filter((f) => f.status !== 'resolved');
    stages.reconcile.in = all.length;
    stages.reconcile.out = open.length;

    // ── 6. Risk context ───────────────────────────────────────────────
    const assessed = assess(open);
    const bands: Record<RiskBand, number> = { act: 0, schedule: 0, backlog: 0 };
    for (const item of assessed) bands[item.risk.band]++;
    stages.risk.in = open.length;
    stages.risk.out = bands.act;

    // ── 7. Prioritize ─────────────────────────────────────────────────
    const actions = buildActions(assessed);
    stages.prioritize.in = bands.act;
    stages.prioritize.out = actions.length;

    const verification = verifyAgainstTruth(world, store, cycle);
    for (const key of verification.wronglyClosed) everWronglyClosed.add(key);

    cycles.push({
      cycle,
      stages,
      transport,
      sync: {
        harbor: {
          scanId: summary.scan_id,
          pagesTotal: summary.total_pages,
          pagesRetrieved: harborPagesRetrieved,
          hostsTargeted: summary.targeted_hosts.length,
          hostsUnreachable: summary.unreachable_hosts.length,
          complete: harborComplete,
        },
        lantern: { cursorBefore, cursorAfter: lanternCursor, pages: lanternPages, complete: lanternComplete },
        sieve: { deliveries: deliveries.length },
      },
      snapshot: {
        total: all.length,
        open: all.filter((f) => f.status === 'open').length,
        pending: all.filter((f) => f.status === 'pending').length,
        resolved: all.filter((f) => f.status === 'resolved').length,
      },
      bands,
      actions: actions.length,
      verification,
    });
  }

  const findings = assess(store.all());
  const stillOpen = findings.filter((f) => f.finding.status !== 'resolved');
  const actions = buildActions(stillOpen);
  const sum = (stage: StageId, field: 'in' | 'out'): number => cycles.reduce((total, c) => total + c.stages[stage][field], 0);

  return {
    config,
    policy,
    world,
    cycles,
    findings,
    actions,
    funnel: {
      received: sum('ingest', 'out'),
      afterDedupe: sum('dedupe', 'out'),
      uniqueFindings: store.size,
      stillOpen: stillOpen.length,
      actNow: stillOpen.filter((f) => f.risk.band === 'act').length,
      actions: actions.length,
    },
    everWronglyClosed: [...everWronglyClosed].sort(),
  };
}
