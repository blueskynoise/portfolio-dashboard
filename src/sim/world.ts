import { findingKey } from './identity';
import { createRng, pick, randInt, weighted, type Rng } from './rng';
import {
  CYCLES,
  type Asset,
  type Environment,
  type ExploitStatus,
  type Severity,
  type SourceId,
  type TruthFinding,
  type Vuln,
  type World,
} from './types';

/**
 * Generates the synthetic world: an asset inventory, a vulnerability
 * catalogue, and the ground truth of which vulnerability really exists
 * where, cycle by cycle.
 *
 * Nothing here refers to real software, real CVEs or real organisations.
 * Identifiers use a SYN- prefix so they can never be mistaken for one.
 */

const SERVICES: readonly (readonly [string, string])[] = [
  ['payments', 'Payments'],
  ['checkout', 'Payments'],
  ['billing', 'Payments'],
  ['identity', 'Identity'],
  ['sessions', 'Identity'],
  ['search', 'Discovery'],
  ['catalog', 'Discovery'],
  ['notify', 'Messaging'],
  ['inbox', 'Messaging'],
  ['metrics', 'Data'],
  ['reports', 'Data'],
  ['gateway', 'Platform'],
  ['deploy', 'Platform'],
  ['wiki', 'Internal Tools'],
  ['helpdesk', 'Internal Tools'],
];
const ROLES = ['api', 'web', 'worker', 'db', 'cache'] as const;

const PACKAGES = [
  'openwidget', 'libquill', 'tinyhinge', 'fastlatch', 'yamlish', 'cronkite', 'pngcrate',
  'httpigeon', 'jsonnetta', 'logloom', 'zipzap', 'authkit-lite', 'sprocket-db', 'glyphtext',
  'queuebird', 'tlsmith', 'cachecow', 'xmlpress', 'nimbus-agent', 'ferrule',
] as const;

const WEAKNESSES = [
  'Remote code execution', 'Path traversal', 'Denial of service', 'Information disclosure',
  'Privilege escalation', 'Improper certificate validation', 'Injection', 'Unsafe deserialization',
  'Authentication bypass', 'Out-of-bounds read',
] as const;

const VULN_COUNT = 90;

/** Every way a finding's real existence can change over the five cycles. Changes stop after cycle 3 so the last two cycles show recovery. */
const TIMELINES: readonly (readonly [boolean[], number])[] = [
  [[true, true, true, true, true], 68], // persistent
  [[true, false, false, false, false], 9], // fixed before scan 2
  [[true, true, false, false, false], 7], // fixed before scan 3
  [[false, true, true, true, true], 5], // new at scan 2
  [[false, false, true, true, true], 4], // new at scan 3
  [[true, false, true, true, true], 5], // "fixed", then regressed
  [[false, true, false, false, false], 2], // appeared and fixed quickly
];

export function severityFromCvss(cvss: number): Severity {
  if (cvss >= 9) return 'critical';
  if (cvss >= 7) return 'high';
  if (cvss >= 4) return 'medium';
  return 'low';
}

function makeVulns(rng: Rng): Vuln[] {
  const fixVersions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    fixVersions.set(pkg, `${randInt(rng, 1, 9)}.${randInt(rng, 0, 20)}.${randInt(rng, 0, 12)}`);
  }
  const vulns: Vuln[] = [];
  for (let i = 1; i <= VULN_COUNT; i++) {
    const pkg = pick(rng, PACKAGES);
    const band = weighted<Severity>(rng, [
      ['critical', 12],
      ['high', 33],
      ['medium', 40],
      ['low', 15],
    ]);
    const [lo, hi] =
      band === 'critical' ? [90, 100] : band === 'high' ? [70, 89] : band === 'medium' ? [40, 69] : [10, 39];
    const cvss = randInt(rng, lo, hi) / 10;
    const exploit = weighted<ExploitStatus>(
      rng,
      band === 'critical' || band === 'high'
        ? [['known', 16], ['poc', 24], ['none', 60]]
        : [['known', 2], ['poc', 8], ['none', 90]],
    );
    vulns.push({
      id: `SYN-2026-${String(i).padStart(4, '0')}`,
      title: `${pick(rng, WEAKNESSES)} in ${pkg}`,
      cvss,
      exploit,
      pkg,
      fixVersion: fixVersions.get(pkg) ?? '1.0.0',
    });
  }
  return vulns;
}

function makeAssets(rng: Rng, count: number): Asset[] {
  const assets: Asset[] = [];
  for (let i = 0; i < count; i++) {
    const [service, owner] = pick(rng, SERVICES);
    const role = pick(rng, ROLES);
    const env = weighted<Environment>(rng, [['prod', 40], ['staging', 25], ['dev', 35]]);
    const internetChance = env === 'prod' ? 0.25 : env === 'staging' ? 0.06 : 0;
    const tier: 1 | 2 | 3 =
      env === 'prod'
        ? weighted<1 | 2 | 3>(rng, [[1, 30], [2, 45], [3, 25]])
        : env === 'staging'
          ? weighted<1 | 2 | 3>(rng, [[2, 40], [3, 60]])
          : 3;
    const coveredBy: SourceId[] = [];
    if (rng() < 0.7) coveredBy.push('harbor');
    if (rng() < 0.6) coveredBy.push('lantern');
    if (rng() < 0.4) coveredBy.push('sieve');
    if (coveredBy.length === 0) coveredBy.push('harbor');
    assets.push({
      id: `${service}-${role}-${String(i + 1).padStart(2, '0')}`,
      env,
      exposure: rng() < internetChance ? 'internet' : 'internal',
      tier,
      owner,
      coveredBy,
    });
  }
  return assets;
}

/** Number of times a finding's real state flips, counting its first appearance. */
export function transitionCycles(active: readonly boolean[]): number[] {
  const cycles: number[] = [];
  let previous = false;
  active.forEach((now, index) => {
    if (now !== previous) cycles.push(index + 1);
    previous = now;
  });
  return cycles;
}

/** Records this finding causes its sources to emit when nothing goes wrong. */
export function cleanRecordCount(f: TruthFinding): number {
  let total = 0;
  const changes = transitionCycles(f.active).length;
  if (f.sources.includes('harbor')) total += f.harborPorts.length * f.active.filter(Boolean).length;
  if (f.sources.includes('lantern')) total += changes;
  if (f.sources.includes('sieve')) total += changes + (f.sieveFlapped ? 2 : 0);
  return total;
}

/**
 * Build a world whose sources emit exactly `alertCount` records over five
 * cycles when nothing goes wrong. (Faults then add redeliveries or lose
 * pages on top of that; the ground truth never changes.)
 */
export function generateWorld(seed: number, alertCount: number): World {
  const rng = createRng(seed);
  const vulns = makeVulns(rng);
  const assets = makeAssets(rng, Math.max(24, Math.min(600, Math.round(alertCount / 55))));
  const truth: TruthFinding[] = [];
  const used = new Set<string>();
  let total = 0;

  const tryAdd = (finding: TruthFinding): boolean => {
    const count = cleanRecordCount(finding);
    if (used.has(finding.key) || total + count > alertCount) return false;
    used.add(finding.key);
    truth.push(finding);
    total += count;
    return true;
  };

  // Regular findings, until one no longer fits in the budget.
  let misses = 0;
  while (total < alertCount && misses < 200) {
    const asset = pick(rng, assets);
    const vuln = pick(rng, vulns);
    const active = [...weighted(rng, TIMELINES)];
    let sources = asset.coveredBy.filter(() => rng() < 0.75);
    if (sources.length === 0) sources = [pick(rng, asset.coveredBy)];
    const ports = weighted(rng, [[1, 60], [2, 30], [3, 10]]);
    const harborPorts = [443, 8443, 8080].slice(0, ports);
    const sieveFlapped = sources.includes('sieve') && active[0] === true && rng() < 0.12;
    const added = tryAdd({
      key: findingKey(asset.id, vuln.id),
      assetId: asset.id,
      vulnId: vuln.id,
      active,
      sources,
      harborPorts,
      sieveFlapped,
    });
    misses = added ? 0 : misses + 1;
  }

  // Top up to the exact total with single-record findings (one sieve "opened" event each).
  let guard = 0;
  while (total < alertCount && guard < 100_000) {
    guard++;
    const asset = pick(rng, assets);
    const vuln = pick(rng, vulns);
    tryAdd({
      key: findingKey(asset.id, vuln.id),
      assetId: asset.id,
      vulnId: vuln.id,
      active: Array.from({ length: CYCLES }, () => true),
      sources: ['sieve'],
      harborPorts: [],
      sieveFlapped: false,
    });
  }

  return {
    seed,
    alertCount,
    assets,
    vulns,
    truth,
    pageSize: Math.max(25, Math.min(500, Math.round(alertCount / 50))),
  };
}
