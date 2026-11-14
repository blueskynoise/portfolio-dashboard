import type { Asset, Vuln } from './types';

/**
 * Risk context.
 *
 * Severity describes the vulnerability. Risk describes the vulnerability
 * *here*: on this asset, with this exposure, given what attackers are
 * actually doing. The score is a plain product of visible factors so that
 * anyone can check why something ranked where it did.
 */

export type RiskBand = 'act' | 'schedule' | 'backlog';

export interface RiskFactor {
  label: string;
  value: string;
  weight: number;
}

export interface RiskAssessment {
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
}

export const RISK_THRESHOLDS = { act: 55, schedule: 25 } as const;

const EXPOSURE_WEIGHT = { internet: 1, internal: 0.8 } as const;
const ENV_WEIGHT = { prod: 1, staging: 0.5, dev: 0.25 } as const;
const EXPLOIT_WEIGHT = { known: 1, poc: 0.75, none: 0.45 } as const;
const TIER_WEIGHT = { 1: 1, 2: 0.85, 3: 0.65 } as const;

const EXPOSURE_LABEL = { internet: 'internet-facing', internal: 'internal only' } as const;
const ENV_LABEL = { prod: 'production', staging: 'staging', dev: 'development' } as const;
const EXPLOIT_LABEL = { known: 'exploited in the wild', poc: 'proof of concept exists', none: 'no known exploit' } as const;

export function assessRisk(vuln: Vuln, asset: Asset): RiskAssessment {
  const factors: RiskFactor[] = [
    { label: 'Severity', value: `CVSS ${vuln.cvss.toFixed(1)}`, weight: vuln.cvss / 10 },
    { label: 'Exploitation', value: EXPLOIT_LABEL[vuln.exploit], weight: EXPLOIT_WEIGHT[vuln.exploit] },
    { label: 'Exposure', value: EXPOSURE_LABEL[asset.exposure], weight: EXPOSURE_WEIGHT[asset.exposure] },
    { label: 'Environment', value: ENV_LABEL[asset.env], weight: ENV_WEIGHT[asset.env] },
    { label: 'Criticality', value: `tier ${asset.tier}`, weight: TIER_WEIGHT[asset.tier] },
  ];
  const score = Math.round(factors.reduce((product, f) => product * f.weight, 100));
  const band: RiskBand =
    score >= RISK_THRESHOLDS.act ? 'act' : score >= RISK_THRESHOLDS.schedule ? 'schedule' : 'backlog';
  return { score, band, factors };
}
