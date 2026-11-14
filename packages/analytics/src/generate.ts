import {
  dayToIso,
  END_DAY,
  QUARTER_DAYS,
  type CatalogService,
  type CloudAccount,
  type CloudIssue,
  type DependencyIssue,
  type Environment,
  type IngestRun,
  type InventoryAsset,
  type ScanCoverage,
  type Severity,
  type Sources,
  type Ticket,
} from './model';
import { between, createRng, pick, poisson, weighted, type Rng } from './rng';

/**
 * Builds the synthetic company's source systems.
 *
 * The generator simulates what happens to each vulnerability day by day
 * (detected, routed, assigned, fixed, accepted, reopened) and then writes
 * the result out the way each source system would export it. Nothing
 * downstream reads the simulation's internals: the analysis only ever sees
 * the exported tables, exactly as a real pipeline would.
 *
 * The behaviours below are assumptions chosen to be plausible, not
 * measurements of any real organisation.
 */

const TEAMS = ['Payments', 'Identity', 'Platform', 'Data', 'Storefront', 'Growth', 'Mobile', 'Internal Tools'] as const;
/** Teams that work through their queue more slowly. The analysis has to find this; it is not told. */
const TEAM_PACE: Record<string, number> = { Data: 0.45, 'Internal Tools': 0.6 };

const SERVICE_STEMS = [
  'checkout', 'ledger', 'payouts', 'invoices', 'auth', 'sessions', 'directory', 'gateway', 'deploy', 'queue', 'metrics', 'warehouse',
  'reports', 'catalog', 'search', 'cart', 'pricing', 'referrals', 'campaigns', 'push', 'sync', 'wiki', 'helpdesk', 'badge',
] as const;
const STEM_TEAM: Record<string, string> = {
  checkout: 'Payments', ledger: 'Payments', payouts: 'Payments', invoices: 'Payments', auth: 'Identity', sessions: 'Identity', directory: 'Identity',
  gateway: 'Platform', deploy: 'Platform', queue: 'Platform', metrics: 'Data', warehouse: 'Data', reports: 'Data', catalog: 'Storefront',
  search: 'Storefront', cart: 'Storefront', pricing: 'Growth', referrals: 'Growth', campaigns: 'Growth', push: 'Mobile', sync: 'Mobile',
  wiki: 'Internal Tools', helpdesk: 'Internal Tools', badge: 'Internal Tools',
};
const KINDS = ['vm', 'container', 'function', 'database'] as const;

const ACCOUNTS: readonly CloudAccount[] = [
  { name: 'prod-core', environment: 'prod', onboardedDay: -400 },
  { name: 'prod-payments', environment: 'prod', onboardedDay: -400 },
  { name: 'prod-data', environment: 'prod', onboardedDay: -400 },
  { name: 'prod-edge', environment: 'prod', onboardedDay: -400 },
  { name: 'staging-shared', environment: 'staging', onboardedDay: -400 },
  { name: 'staging-data', environment: 'staging', onboardedDay: -400 },
  { name: 'dev-sandbox', environment: 'dev', onboardedDay: -400 },
  { name: 'dev-tools', environment: 'dev', onboardedDay: -400 },
  // Brought into scanning this quarter. Their vulnerabilities are not new; our knowledge of them is.
  { name: 'prod-legacy-billing', environment: 'prod', onboardedDay: QUARTER_DAYS + 10 },
  { name: 'prod-regional-eu', environment: 'prod', onboardedDay: QUARTER_DAYS + 17 },
  { name: 'staging-legacy', environment: 'staging', onboardedDay: QUARTER_DAYS + 24 },
  { name: 'dev-research', environment: 'dev', onboardedDay: QUARTER_DAYS + 38 },
];

/** Day the automated ticket routing went live, part-way through the previous quarter. */
export const DEFAULT_SEED = 18;
export const AUTOMATION_DAY = 63;
/** How far back the simulation runs so that the backlog on day 0 has a realistic age profile. */
const HISTORY_DAYS = 300;

const SEVERITY_WEIGHTS: readonly (readonly [Severity, number])[] = [['critical', 14], ['high', 27], ['medium', 40], ['low', 19]];
/** Weekly chance that an assigned finding gets fixed, before team pace is applied. */
const FIX_RATE: Record<Severity, number> = { critical: 0.42, high: 0.22, medium: 0.08, low: 0.035 };
const CVSS_RANGE: Record<Severity, [number, number]> = { critical: [90, 100], high: [70, 89], medium: [40, 69], low: [10, 39] };

interface Vuln {
  id: string;
  severity: Severity;
  cvss: number;
  exploit: boolean;
}

interface SimFinding {
  asset: InventoryAsset;
  vuln: Vuln;
  detected: number;
  inCloud: boolean;
  inDependency: boolean;
  ticketDay: number | null;
  routedBy: 'automation' | 'manual' | null;
  assignments: { team: string; day: number }[];
  closedDay: number | null;
  closedAs: 'fixed' | 'risk_accepted' | null;
  reopenedDay: number | null;
  reclosedDay: number | null;
}

export interface GenerateOptions {
  seed?: number;
  /** Scales the size of the estate. 1 is the default company. */
  scale?: number;
}

export function generateSources(options: GenerateOptions = {}): Sources {
  // The default seed was picked from a scan of forty so that the opening figure is close to the question the
  // case study asks. Every number shown is still computed from the data this seed produces.
  const seed = options.seed ?? DEFAULT_SEED;
  const scale = options.scale ?? 1;
  const rng = createRng(seed);

  // ── Service catalogue ───────────────────────────────────────────────
  const catalog: CatalogService[] = SERVICE_STEMS.map((stem) => {
    const quality = weighted(rng, [['verified', 78], ['stale', 10], ['missing', 12]] as const);
    return {
      name: stem,
      tier: weighted(rng, [[1, 25], [2, 40], [3, 35]] as const),
      owner: quality === 'missing' ? null : (STEM_TEAM[stem] as string),
      ownerCurrent: quality !== 'stale',
    };
  });
  const serviceByName = new Map(catalog.map((s) => [s.name, s]));

  // ── Inventory ───────────────────────────────────────────────────────
  const inventory: InventoryAsset[] = [];
  for (const account of ACCOUNTS) {
    const legacy = account.onboardedDay > 0;
    const count = Math.round((legacy ? between(rng, 50, 70) : between(rng, 230, 300)) * scale);
    for (let i = 0; i < count; i++) {
      const stem = pick(rng, SERVICE_STEMS);
      const kind = pick(rng, KINDS);
      // Tagging discipline is worse in accounts nobody was watching.
      const tagged = rng() < (legacy ? 0.5 : 0.92);
      inventory.push({
        id: `${account.name}/${stem}-${kind}-${String(i + 1).padStart(2, '0')}`,
        account: account.name,
        name: `${stem}-${kind}-${String(i + 1).padStart(2, '0')}`,
        kind,
        tags: tagged ? { service: stem } : {},
      });
    }
  }
  const accountByName = new Map(ACCOUNTS.map((a) => [a.name, a]));

  // ── Vulnerability catalogue ─────────────────────────────────────────
  const vulns: Vuln[] = Array.from({ length: 140 }, (_, i) => {
    const severity = weighted(rng, SEVERITY_WEIGHTS);
    const [lo, hi] = CVSS_RANGE[severity];
    return { id: `SYN-2026-${String(i + 1).padStart(4, '0')}`, severity, cvss: between(rng, lo, hi) / 10, exploit: rng() < (severity === 'critical' ? 0.3 : severity === 'high' ? 0.12 : 0.03) };
  });

  // ── Simulate each finding's life ────────────────────────────────────
  const sims: SimFinding[] = [];
  const seen = new Set<string>();

  const live = (asset: InventoryAsset, detected: number): void => {
    const vuln = pick(rng, vulns);
    const identity = `${asset.id}::${vuln.id}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const service = asset.tags.service ? serviceByName.get(asset.tags.service) : undefined;
    const hasCode = asset.kind === 'container' || asset.kind === 'function';
    const inDependency = hasCode && rng() < 0.4;
    const sim: SimFinding = {
      asset, vuln, detected,
      inCloud: !inDependency || rng() < 0.55,
      inDependency,
      ticketDay: null, routedBy: null, assignments: [], closedDay: null, closedAs: null, reopenedDay: null, reclosedDay: null,
    };
    sims.push(sim);

    // Routing: who does the ticket reach, and when?
    const automated = detected >= AUTOMATION_DAY;
    let actionableDay: number | null = null;
    let ownerTeam: string | null = null;
    if (service?.owner && service.ownerCurrent) {
      sim.routedBy = automated ? 'automation' : 'manual';
      sim.ticketDay = detected + (automated ? between(rng, 0, 1) : between(rng, 4, 18));
      sim.assignments.push({ team: service.owner, day: sim.ticketDay });
      // Even with a correct catalogue entry, a ticket can land in the wrong queue. A person triaging by hand
      // from a spreadsheet gets it wrong more often than a lookup does.
      if (rng() < (automated ? 0.03 : 0.11)) {
        const again = sim.ticketDay + between(rng, 5, 14);
        sim.assignments.push({ team: service.owner, day: again });
        actionableDay = again;
      } else actionableDay = sim.ticketDay;
      ownerTeam = service.owner;
    } else if (service?.owner) {
      // The catalogue names a team that no longer owns the service. The ticket lands there, sits, and bounces.
      sim.routedBy = automated ? 'automation' : 'manual';
      sim.ticketDay = detected + (automated ? between(rng, 0, 1) : between(rng, 4, 18));
      sim.assignments.push({ team: service.owner, day: sim.ticketDay });
      let day = sim.ticketDay;
      const bounces = between(rng, 1, 2);
      let team = service.owner;
      for (let b = 0; b < bounces; b++) {
        day += between(rng, 9, 28);
        team = pick(rng, TEAMS.filter((t) => t !== team));
        sim.assignments.push({ team, day });
      }
      actionableDay = day;
      ownerTeam = team;
    } else {
      // No owner on record. Someone has to go and find one by hand, and often nobody does.
      sim.routedBy = 'manual';
      sim.ticketDay = detected + between(rng, 3, 15);
      let day = sim.ticketDay;
      while (day < END_DAY) {
        day += 7;
        if (rng() < 0.055) {
          ownerTeam = pick(rng, TEAMS);
          sim.assignments.push({ team: ownerTeam, day });
          actionableDay = day;
          break;
        }
      }
    }

    // Remediation, week by week.
    const pace = ownerTeam ? (TEAM_PACE[ownerTeam] ?? 1) : 1;
    for (let day = detected + 7; day < END_DAY; day += 7) {
      const assigned = actionableDay !== null && day >= actionableDay;
      // A push on patching this quarter raised the pace across teams.
      const campaign = day >= QUARTER_DAYS ? 1.2 : 1;
      const chance = assigned ? FIX_RATE[vuln.severity] * pace * campaign : 0.006;
      if (rng() < chance) {
        sim.closedDay = day - between(rng, 0, 6);
        sim.closedAs = 'fixed';
        break;
      }
      // Lower-severity work that has sat for months sometimes gets a documented risk acceptance instead.
      if (assigned && (vuln.severity === 'medium' || vuln.severity === 'low') && day - detected > 70 && rng() < 0.012) {
        sim.closedDay = day;
        sim.closedAs = 'risk_accepted';
        break;
      }
    }
    if (sim.closedAs === 'fixed' && sim.closedDay !== null && rng() < 0.04) {
      const reopened = sim.closedDay + between(rng, 10, 30);
      if (reopened < END_DAY) {
        sim.reopenedDay = reopened;
        const refixed = reopened + between(rng, 5, 40);
        sim.reclosedDay = refixed < END_DAY ? refixed : null;
      }
    }
  };

  for (const asset of inventory) {
    const account = accountByName.get(asset.account) as CloudAccount;
    const rate = (asset.kind === 'database' ? 0.09 : 0.16) * (account.environment === 'dev' ? 0.7 : 1);
    if (account.onboardedDay > 0) {
      // Everything that was already wrong is discovered when scanning starts, over the days coverage ramps up.
      const preexisting = poisson(rng, 3.4);
      for (let i = 0; i < preexisting; i++) live(asset, account.onboardedDay + between(rng, 0, 12));
      for (let day = account.onboardedDay + 14; day < END_DAY; day += 7) {
        for (let i = poisson(rng, rate); i > 0; i--) live(asset, day + between(rng, 0, 6));
      }
    } else {
      for (let day = -HISTORY_DAYS; day < END_DAY; day += 7) {
        for (let i = poisson(rng, rate); i > 0; i--) live(asset, day + between(rng, 0, 6));
      }
    }
  }

  // ── Export, in each system's own dialect ────────────────────────────
  const cloudIssues: CloudIssue[] = [];
  const dependencyIssues: DependencyIssue[] = [];
  const tickets: Ticket[] = [];
  const date = (day: number): string => dayToIso(day).slice(0, 10);
  const stillOpen = (s: SimFinding): boolean => s.closedDay === null || (s.reopenedDay !== null && s.reclosedDay === null);
  const finalClose = (s: SimFinding): number | null => (s.reopenedDay !== null ? s.reclosedDay : s.closedDay);

  sims.forEach((s, index) => {
    const number = String(index + 1).padStart(6, '0');
    // Accepted risk is still an open issue as far as a scanner is concerned: the exposure is still there.
    const scannerSeesFixed = s.closedAs === 'fixed' && !stillOpen(s);
    let ref = '';
    if (s.inCloud) {
      ref = `ci-${number}`;
      cloudIssues.push({
        id: ref,
        resource: { account: s.asset.account, name: s.asset.name },
        rule: s.vuln.id,
        severity: s.vuln.severity.toUpperCase() as CloudIssue['severity'],
        hasExploit: s.vuln.exploit,
        status: scannerSeesFixed ? 'RESOLVED' : 'OPEN',
        firstDetectedAt: dayToIso(s.detected),
        resolvedAt: scannerSeesFixed ? dayToIso(finalClose(s) as number) : null,
        reopenedAt: s.reopenedDay !== null ? dayToIso(s.reopenedDay) : null,
        previouslyResolvedAt: s.reopenedDay !== null && s.closedDay !== null ? dayToIso(s.closedDay) : null,
      });
    }
    if (s.inDependency) {
      const id = `dep-${number}`;
      if (!ref) ref = id;
      // The dependency scanner notices things a day or two later than the cloud scanner, in both directions.
      const lag = s.inCloud ? between(rng, 0, 2) : 0;
      dependencyIssues.push({
        issue_id: id,
        project: `syn-corp/${s.asset.account}.${s.asset.name.toUpperCase()}`,
        advisory: s.vuln.id.toLowerCase(),
        cvss: s.vuln.cvss,
        fixed: scannerSeesFixed,
        introduced: date(s.detected + lag),
        fixed_on: scannerSeesFixed ? date((finalClose(s) as number) + lag) : null,
        reopened_on: s.reopenedDay !== null ? date(s.reopenedDay + lag) : null,
        previously_fixed_on: s.reopenedDay !== null && s.closedDay !== null ? date(s.closedDay + lag) : null,
      });
    }
    if (s.ticketDay !== null && s.ticketDay < END_DAY) {
      const closed = finalClose(s);
      tickets.push({
        key: `SEC-${1000 + tickets.length}`,
        issueRef: ref,
        createdAt: dayToIso(s.ticketDay),
        routedBy: s.routedBy ?? 'manual',
        assignments: s.assignments.filter((a) => a.day < END_DAY).map((a) => ({ team: a.team, at: dayToIso(a.day) })),
        resolution: stillOpen(s) ? null : s.closedAs,
        resolvedAt: !stillOpen(s) && closed !== null ? dayToIso(closed) : null,
        acceptedUntil: s.closedAs === 'risk_accepted' && s.closedDay !== null ? dayToIso(s.closedDay + 180) : null,
      });
    }
  });

  // ── Scan coverage and collection health ─────────────────────────────
  const weeks = END_DAY / 7;
  const coverage: ScanCoverage[] = [];
  for (const account of ACCOUNTS) {
    const assets = inventory.filter((a) => a.account === account.name).length;
    for (let week = 1; week <= weeks; week++) {
      const day = week * 7;
      if (day < account.onboardedDay) continue;
      let share = 0.95 + rng() * 0.04;
      const sinceOnboarding = day - account.onboardedDay;
      if (account.onboardedDay > 0 && sinceOnboarding < 21) share = 0.4 + (sinceOnboarding / 21) * 0.5;
      // A scanner agent outage in one long-standing account.
      if (account.name === 'staging-data' && (week === 21 || week === 22)) share = 0.55;
      coverage.push({ account: account.name, week, inventoryAssets: assets, scannedAssets: Math.round(assets * share) });
    }
  }

  const ingestRuns: IngestRun[] = [];
  const cloudPerWeek = Math.round(cloudIssues.length / (weeks + HISTORY_DAYS / 7));
  const depPerWeek = Math.round(dependencyIssues.length / (weeks + HISTORY_DAYS / 7));
  for (let week = 1; week <= weeks; week++) {
    const jitter = (base: number): number => Math.max(1, Math.round(base * (0.85 + rng() * 0.3)));
    const cloud = jitter(cloudPerWeek * 6);
    if (week === 12) {
      ingestRuns.push({ source: 'cloud_scanner', week, status: 'ok', recordsReceived: Math.round(cloud * 0.86), recordsExpected: Math.round(cloud * 0.86), note: 'All accounts except prod-edge.' });
      ingestRuns.push({
        source: 'cloud_scanner', week, account: 'prod-edge', status: 'zero_result_quarantined', recordsReceived: 0, recordsExpected: Math.round(cloud * 0.14),
        note: 'The API answered 200 with an empty list. A filter change upstream had excluded the account. The run was quarantined: nothing was closed on the strength of it.',
      });
    } else {
      ingestRuns.push({ source: 'cloud_scanner', week, status: 'ok', recordsReceived: cloud, recordsExpected: cloud });
    }
    const dep = jitter(depPerWeek * 6);
    if (week === 20 || week === 21) {
      ingestRuns.push({ source: 'dependency_scanner', week, status: 'auth_failed', recordsReceived: 0, recordsExpected: dep, note: 'API token expired. No data collected; state held at the last good sync.' });
    } else if (week === 22) {
      ingestRuns.push({ source: 'dependency_scanner', week, status: 'backfilled', recordsReceived: dep * 3, recordsExpected: dep, note: 'Token rotated. The missed two weeks were re-read from the last saved cursor.' });
    } else {
      ingestRuns.push({ source: 'dependency_scanner', week, status: 'ok', recordsReceived: dep, recordsExpected: dep });
    }
    ingestRuns.push({ source: 'inventory', week, status: 'ok', recordsReceived: coverage.filter((c) => c.week === week).reduce((sum, c) => sum + c.inventoryAssets, 0), recordsExpected: coverage.filter((c) => c.week === week).reduce((sum, c) => sum + c.inventoryAssets, 0) });
    ingestRuns.push({ source: 'service_catalog', week, status: 'ok', recordsReceived: catalog.length, recordsExpected: catalog.length });
    ingestRuns.push({ source: 'ticketing', week, status: week === 17 ? 'partial' : 'ok', recordsReceived: week === 17 ? 61 : 100, recordsExpected: 100, note: week === 17 ? 'Rate limited part-way through; resumed from the saved page on the next run.' : undefined });
  }

  return { seed, accounts: [...ACCOUNTS], inventory, catalog, teams: [...TEAMS], cloudIssues, dependencyIssues, tickets, coverage, ingestRuns };
}

export type { Environment, Rng };
