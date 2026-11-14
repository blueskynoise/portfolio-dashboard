import type { RiskAssessment } from './risk';
import type { Asset, Finding, Vuln } from './types';

/**
 * Remediation prioritization.
 *
 * Nobody fixes "a finding". They upgrade a package on some machines. So
 * the output of the pipeline is a short list of pieces of work, ranked by
 * how much real risk each one removes.
 */

export interface AssessedFinding {
  finding: Finding;
  vuln: Vuln;
  asset: Asset;
  risk: RiskAssessment;
}

export interface RemediationAction {
  id: string;
  pkg: string;
  fixVersion: string;
  /** Findings in the "act now" band that this action closes. */
  urgent: AssessedFinding[];
  /** Other open findings the same upgrade on the same assets also closes. */
  alsoCloses: number;
  assets: string[];
  owners: string[];
  /** Sum of the urgent findings' scores: the ranking key. */
  riskRemoved: number;
  topScore: number;
}

export function buildActions(open: readonly AssessedFinding[]): RemediationAction[] {
  const byPkg = new Map<string, AssessedFinding[]>();
  for (const item of open) {
    if (item.risk.band !== 'act') continue;
    const list = byPkg.get(item.vuln.pkg);
    if (list) list.push(item);
    else byPkg.set(item.vuln.pkg, [item]);
  }

  const actions: RemediationAction[] = [];
  for (const [pkg, urgent] of byPkg) {
    urgent.sort((a, b) => b.risk.score - a.risk.score || a.finding.key.localeCompare(b.finding.key));
    const assets = [...new Set(urgent.map((u) => u.asset.id))].sort();
    const assetSet = new Set(assets);
    const urgentKeys = new Set(urgent.map((u) => u.finding.key));
    const alsoCloses = open.filter(
      (o) => o.vuln.pkg === pkg && assetSet.has(o.asset.id) && !urgentKeys.has(o.finding.key),
    ).length;
    actions.push({
      id: `upgrade-${pkg}`,
      pkg,
      fixVersion: urgent[0]?.vuln.fixVersion ?? '',
      urgent,
      alsoCloses,
      assets,
      owners: [...new Set(urgent.map((u) => u.asset.owner))].sort(),
      riskRemoved: urgent.reduce((sum, u) => sum + u.risk.score, 0),
      topScore: urgent[0]?.risk.score ?? 0,
    });
  }
  return actions.sort((a, b) => b.riskRemoved - a.riskRemoved || a.pkg.localeCompare(b.pkg));
}
