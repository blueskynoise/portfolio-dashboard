import { forkRng, hashString, randInt, shuffle } from './rng';
import type { HttpResult } from './transport';
import {
  CYCLES,
  DAY_MS,
  T0,
  type FaultConfig,
  type HarborRaw,
  type LanternRaw,
  type SieveRaw,
  type TruthFinding,
  type Vuln,
  type World,
} from './types';
import { severityFromCvss, transitionCycles } from './world';

/**
 * The simulated source systems.
 *
 * This file is the "outside world": it decides what each fictional
 * scanner sends and how it misbehaves. The pipeline never looks inside;
 * it only sees HTTP-shaped responses and raw records, the same way a real
 * integration would.
 */

export interface HarborScanSummary {
  scan_id: string;
  status: 'completed';
  targeted_hosts: string[];
  unreachable_hosts: string[];
  total_pages: number;
}

export interface LanternPage {
  records: LanternRaw[];
  next_cursor: number;
  has_more: boolean;
}

interface LanternLogEntry {
  pos: number;
  cycle: number;
  record: LanternRaw;
  /** With the missing-updates fault on, the feed never mentions this entry. */
  omitted: boolean;
}

interface PageFaults {
  /** How many 429s a page serves before it answers. */
  rateLimited: Map<string, number>;
  dead: Set<string>;
}

const HARBOR_FAILURE_CYCLE = 2;
const LANTERN_FAILURE_CYCLE = 3;
const DISAPPEAR_CYCLE = 3;

const cycleTime = (cycle: number): number => T0 + (cycle - 1) * DAY_MS;
const titleCase = (id: string): string =>
  id.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-');
const HARBOR_RISK = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as const;
const SIEVE_LEVEL = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export function lanternUid(key: string): string {
  return `lf-${hashString(key).toString(16).padStart(8, '0')}`;
}

export class SourceSimulator {
  private readonly vulnById = new Map<string, Vuln>();
  private readonly harborPages = new Map<number, HarborRaw[][]>();
  private readonly harborSummaries = new Map<number, HarborScanSummary>();
  private readonly lanternLog: LanternLogEntry[] = [];
  private readonly sieveBatches = new Map<number, SieveRaw[]>();
  private readonly faultsByPage: PageFaults = { rateLimited: new Map(), dead: new Set() };
  /** Truly-present findings the scanner fails to report for one scan (disappearing fault). */
  readonly flakedKeys = new Set<string>();
  readonly offlineAssets = new Set<string>();

  constructor(
    private readonly world: World,
    private readonly faults: FaultConfig,
  ) {
    for (const vuln of world.vulns) this.vulnById.set(vuln.id, vuln);
    this.buildHarbor();
    this.buildLantern();
    this.buildSieve();
  }

  private vuln(id: string): Vuln {
    const vuln = this.vulnById.get(id);
    if (!vuln) throw new Error(`unknown vuln ${id}`);
    return vuln;
  }

  // ── harbor: snapshot scans ──────────────────────────────────────────

  private buildHarbor(): void {
    const { world, faults } = this;
    const tracked = world.truth.filter((f) => f.sources.includes('harbor'));
    const targeted = world.assets.filter((a) => a.coveredBy.includes('harbor')).map((a) => a.id);

    if (faults.disappearing) {
      const rng = forkRng(world.seed, 'disappearing');
      const present = tracked.filter((f) => f.active[DISAPPEAR_CYCLE - 1]);
      const assetsWithFindings = [...new Set(present.map((f) => f.assetId))];
      const offlineCount = Math.max(1, Math.round(assetsWithFindings.length * 0.05));
      for (const id of shuffle(rng, [...assetsWithFindings]).slice(0, offlineCount)) {
        this.offlineAssets.add(id);
      }
      const flakable = present.filter((f) => !this.offlineAssets.has(f.assetId));
      const flakeCount = Math.min(flakable.length, Math.max(1, Math.round(flakable.length * 0.02)));
      for (const f of shuffle(rng, [...flakable]).slice(0, flakeCount)) this.flakedKeys.add(f.key);
    }

    const pageFaultRng = forkRng(world.seed, 'harbor-pages');
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const disappearingNow = faults.disappearing && cycle === DISAPPEAR_CYCLE;
      const scanId = `scan-${String(cycle).padStart(4, '0')}`;
      const records: HarborRaw[] = [];
      for (const f of tracked) {
        if (!f.active[cycle - 1]) continue;
        if (disappearingNow && (this.offlineAssets.has(f.assetId) || this.flakedKeys.has(f.key))) continue;
        const vuln = this.vuln(f.vulnId);
        for (const port of f.harborPorts) {
          records.push({
            scan_id: scanId,
            host: `${f.assetId.toUpperCase()}.corp.example`,
            plugin: f.vulnId.toLowerCase(),
            risk: HARBOR_RISK[severityFromCvss(vuln.cvss)],
            port,
            last_seen: new Date(cycleTime(cycle)).toISOString(),
          });
        }
      }
      records.sort((a, b) => a.host.localeCompare(b.host) || a.plugin.localeCompare(b.plugin) || a.port - b.port);

      const pages: HarborRaw[][] = [];
      for (let start = 0; start < records.length; start += world.pageSize) {
        const page = records.slice(start, start + world.pageSize);
        // Offset pagination drifts when data changes underneath it: the tail of one page shows up again at the head of the next.
        if (faults.duplicates && start > 0) page.unshift(...records.slice(Math.max(0, start - 3), start));
        pages.push(page);
      }
      if (pages.length === 0) pages.push([]);
      this.harborPages.set(cycle, pages);
      this.harborSummaries.set(cycle, {
        scan_id: scanId,
        status: 'completed',
        targeted_hosts: targeted,
        unreachable_hosts: disappearingNow ? [...this.offlineAssets] : [],
        total_pages: pages.length,
      });

      pages.forEach((_, index) => {
        if (faults.rateLimit && pageFaultRng() < 0.3) {
          this.faultsByPage.rateLimited.set(`harbor:${cycle}:${index}`, randInt(pageFaultRng, 1, 3));
        }
      });
      if (faults.partialFailure && cycle === HARBOR_FAILURE_CYCLE) {
        // Prefer a middle page so the loss is not conveniently at the edge.
        this.faultsByPage.dead.add(`harbor:${cycle}:${Math.floor(pages.length / 2)}`);
      }
    }
  }

  harborSummary(cycle: number): HarborScanSummary {
    const summary = this.harborSummaries.get(cycle);
    if (!summary) throw new Error(`no harbor scan for cycle ${cycle}`);
    return summary;
  }

  harborPage(cycle: number, page: number, attempt: number): HttpResult<HarborRaw[]> {
    const key = `harbor:${cycle}:${page}`;
    if (this.faultsByPage.dead.has(key)) return { status: 503 };
    if (attempt <= (this.faultsByPage.rateLimited.get(key) ?? 0)) {
      return { status: 429, retryAfterMs: 1000 + ((hashString(key) + attempt) % 5) * 500 };
    }
    return { status: 200, body: this.harborPages.get(cycle)?.[page] ?? [] };
  }

  // ── lantern: incremental change feed ────────────────────────────────

  private buildLantern(): void {
    const { world, faults } = this;
    const revs = new Map<string, number>();
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      for (const f of world.truth) {
        if (!f.sources.includes('lantern')) continue;
        const now = f.active[cycle - 1] ?? false;
        const before = cycle === 1 ? false : (f.active[cycle - 2] ?? false);
        if (now === before) continue;
        const rev = (revs.get(f.key) ?? 0) + 1;
        revs.set(f.key, rev);
        this.lanternLog.push({
          pos: this.lanternLog.length + 1,
          cycle,
          omitted: false,
          record: {
            finding_uid: lanternUid(f.key),
            rev,
            resource: { name: `asset/${f.assetId}` },
            vulnerability_id: f.vulnId.toLowerCase(),
            severity_score: this.vuln(f.vulnId).cvss,
            state: now ? 'ACTIVE' : 'REMEDIATED',
            updated_at: Math.floor(cycleTime(cycle) / 1000) + (this.lanternLog.length % 3600),
          },
        });
      }
    }

    if (faults.missingUpdates) {
      const rng = forkRng(world.seed, 'missing-updates');
      const updates = this.lanternLog.filter((entry) => entry.cycle >= 2);
      let omitted = 0;
      for (const entry of updates) {
        if (rng() < 0.3) {
          entry.omitted = true;
          omitted++;
        }
      }
      const first = updates[0];
      if (omitted === 0 && first) first.omitted = true;
    }

    if (faults.rateLimit) {
      const rng = forkRng(world.seed, 'lantern-pages');
      for (let cycle = 1; cycle <= CYCLES; cycle++) {
        for (let index = 0; index < 64; index++) {
          if (rng() < 0.3) this.faultsByPage.rateLimited.set(`lantern:${cycle}:${index}`, randInt(rng, 1, 3));
        }
      }
    }
    if (faults.partialFailure) this.faultsByPage.dead.add(`lantern:${LANTERN_FAILURE_CYCLE}:0`);
  }

  /** `GET /changes?after=<cursor>` as of the given cycle. `pageIndex` counts requests within one sync. */
  lanternChanges(cursor: number, cycle: number, pageIndex: number, attempt: number): HttpResult<LanternPage> {
    const key = `lantern:${cycle}:${pageIndex}`;
    if (this.faultsByPage.dead.has(key)) return { status: 503 };
    if (attempt <= (this.faultsByPage.rateLimited.get(key) ?? 0)) {
      return { status: 429, retryAfterMs: 1000 + ((hashString(key) + attempt) % 5) * 500 };
    }
    const available = this.lanternLog.filter((entry) => entry.pos > cursor && entry.cycle <= cycle);
    const visible = available.filter((entry) => !entry.omitted);
    const slice = visible.slice(0, this.world.pageSize);
    const hasMore = visible.length > slice.length;
    const lastAvailable = available[available.length - 1];
    const lastSent = slice[slice.length - 1];
    const nextCursor = hasMore ? (lastSent?.pos ?? cursor) : (lastAvailable?.pos ?? cursor);
    return {
      status: 200,
      body: { records: slice.map((entry) => entry.record), next_cursor: nextCursor, has_more: hasMore },
    };
  }

  /** `GET /inventory`: every finding's current revision. Small, cheap, and never omits anything. */
  lanternInventory(cycle: number): { finding_uid: string; rev: number }[] {
    const latest = new Map<string, number>();
    for (const entry of this.lanternLog) {
      if (entry.cycle <= cycle) latest.set(entry.record.finding_uid, entry.record.rev);
    }
    return [...latest].map(([finding_uid, rev]) => ({ finding_uid, rev }));
  }

  /** `GET /findings/<uid>` as of the given cycle. */
  lanternGet(uid: string, cycle: number): LanternRaw | undefined {
    let latest: LanternRaw | undefined;
    for (const entry of this.lanternLog) {
      if (entry.cycle <= cycle && entry.record.finding_uid === uid) latest = entry.record;
    }
    return latest;
  }

  // ── sieve: pushed events ────────────────────────────────────────────

  private buildSieve(): void {
    const { world, faults } = this;
    type Planned = Omit<SieveRaw, 'delivery_id'> & { cycle: number; key: string };
    const planned: Planned[] = [];

    const emit = (f: TruthFinding, cycle: number, seq: number, action: 'opened' | 'fixed', at: number): void => {
      planned.push({
        cycle,
        key: f.key,
        event_id: `evt-${hashString(f.key).toString(16).padStart(8, '0')}-${seq}`,
        asset: titleCase(f.assetId),
        advisory: f.vulnId,
        level: SIEVE_LEVEL[severityFromCvss(this.vuln(f.vulnId).cvss)],
        action,
        seq,
        occurred_at: at,
      });
    };

    world.truth.forEach((f, index) => {
      if (!f.sources.includes('sieve')) return;
      let seq = 0;
      const offset = (index % 3600) * 1000;
      if (f.sieveFlapped) {
        emit(f, 1, ++seq, 'opened', T0 - 3 * DAY_MS + offset);
        emit(f, 1, ++seq, 'fixed', T0 - 2 * DAY_MS + offset);
      }
      for (const cycle of transitionCycles(f.active)) {
        emit(f, cycle, ++seq, f.active[cycle - 1] ? 'opened' : 'fixed', cycleTime(cycle) - DAY_MS / 2 + offset);
      }
    });

    if (faults.outOfOrder) {
      // A "fixed" event that shows up a day late, after the finding has already been re-opened.
      const reopenedAt = new Set(planned.filter((e) => e.action === 'opened').map((e) => `${e.key}@${e.cycle}`));
      for (const event of planned) {
        if (event.action === 'fixed' && reopenedAt.has(`${event.key}@${event.cycle + 1}`)) event.cycle += 1;
      }
    }

    let deliveries = 0;
    const deliver = (event: Planned): SieveRaw => ({
      delivery_id: `dlv-${String(++deliveries).padStart(6, '0')}`,
      event_id: event.event_id,
      asset: event.asset,
      advisory: event.advisory,
      level: event.level,
      action: event.action,
      seq: event.seq,
      occurred_at: event.occurred_at,
    });

    const redeliverRng = forkRng(world.seed, 'sieve-redelivery');
    const orderRng = forkRng(world.seed, 'sieve-order');
    const carriedOver: Planned[] = [];

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const batch = planned
        .filter((e) => e.cycle === cycle)
        .sort((a, b) => a.occurred_at - b.occurred_at || a.seq - b.seq);
      const redeliveries = carriedOver.splice(0);
      if (faults.duplicates) {
        for (const event of batch) {
          if (redeliverRng() >= 0.08) continue;
          if (redeliverRng() < 0.5 || cycle === CYCLES) redeliveries.push(event);
          else carriedOver.push(event);
        }
      }
      const ordered = [...batch, ...redeliveries];

      if (faults.outOfOrder) {
        shuffle(orderRng, ordered);
        // Make sure the hard case actually happens: for any finding with
        // several events in this batch, the newest one arrives first.
        const slots = new Map<string, number[]>();
        ordered.forEach((event, i) => {
          const list = slots.get(event.key);
          if (list) list.push(i);
          else slots.set(event.key, [i]);
        });
        for (const indexes of slots.values()) {
          if (indexes.length < 2) continue;
          const events = indexes.map((i) => ordered[i] as Planned).sort((a, b) => b.seq - a.seq);
          indexes.forEach((slot, n) => {
            ordered[slot] = events[n] as Planned;
          });
        }
      }
      this.sieveBatches.set(cycle, ordered.map(deliver));
    }
  }

  sieveDeliveries(cycle: number): SieveRaw[] {
    return this.sieveBatches.get(cycle) ?? [];
  }
}
