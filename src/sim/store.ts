import { findingId, findingKey } from './identity';
import type {
  DecisionCode,
  Finding,
  FindingStatus,
  Observation,
  Policy,
  SourceId,
  SourceObs,
} from './types';

/**
 * Finding state.
 *
 * Each source keeps its own opinion of a finding (`obs`). The finding's
 * overall status is derived from those opinions and never set directly,
 * which is what stops one scanner's silence from overruling another
 * scanner's evidence.
 */

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export function deriveStatus(obs: Finding['obs']): FindingStatus {
  const states = Object.values(obs).map((o) => o.status);
  if (states.includes('open')) return 'open';
  if (states.includes('absent_pending')) return 'pending';
  return 'resolved';
}

export interface ApplyResult {
  code: DecisionCode;
  finding: Finding;
}

export interface SnapshotScan {
  source: SourceId;
  cycle: number;
  /** True only if the scan finished and every page of results was retrieved. */
  complete: boolean;
  /** Assets the scan actually reached. */
  scannedAssets: ReadonlySet<string>;
}

export type AbsenceCode =
  | 'absence_pending'
  | 'absence_confirmed'
  | 'held_incomplete_scan'
  | 'held_asset_not_scanned';

export class FindingStore {
  private readonly byKey = new Map<string, Finding>();

  get(key: string): Finding | undefined {
    return this.byKey.get(key);
  }

  all(): Finding[] {
    return [...this.byKey.values()];
  }

  get size(): number {
    return this.byKey.size;
  }

  private refresh(finding: Finding): void {
    const next = deriveStatus(finding.obs);
    if (finding.status === 'resolved' && next === 'open') finding.reopenCount++;
    finding.status = next;
  }

  /** Apply one normalized observation. Returns what was decided and why it mattered. */
  apply(observation: Observation, cycle: number, policy: Policy): ApplyResult {
    const key = findingKey(observation.assetId, observation.vulnId);
    const incoming: SourceObs = {
      status: observation.status,
      version: observation.version,
      lastSeenCycle: cycle,
      missed: 0,
      sourceRef: observation.sourceRef,
    };

    let finding = this.byKey.get(key);
    if (!finding) {
      finding = {
        id: findingId(key),
        key,
        assetId: observation.assetId,
        vulnId: observation.vulnId,
        severity: observation.severity,
        obs: { [observation.source]: incoming },
        status: observation.status === 'open' ? 'open' : 'resolved',
        firstSeenCycle: cycle,
        reopenCount: 0,
        alertCount: 1,
        statusByCycle: Array.from({ length: cycle - 1 }, () => null),
        history: [],
      };
      this.byKey.set(key, finding);
      return { code: 'created', finding };
    }

    finding.alertCount++;
    // Sources disagree about severity; keep the most cautious reading.
    if (SEVERITY_RANK[observation.severity] > SEVERITY_RANK[finding.severity]) {
      finding.severity = observation.severity;
    }

    const current = finding.obs[observation.source];
    if (!current) {
      finding.obs[observation.source] = incoming;
      this.refresh(finding);
      return { code: 'source_linked', finding };
    }

    if (policy.orderByVersion) {
      // The source's own version decides, not the order things arrived in.
      if (observation.version < current.version) return { code: 'stale_ignored', finding };
      if (observation.version === current.version) return { code: 'instance_merged', finding };
    }

    const previous = current.status;
    finding.obs[observation.source] = incoming;
    this.refresh(finding);

    if (observation.status === 'fixed') {
      return { code: previous === 'fixed' ? 'refreshed' : 'fixed_by_source', finding };
    }
    if (previous === 'fixed' || previous === 'absent_confirmed') return { code: 'reopened', finding };
    if (previous === 'absent_pending') return { code: 'reappeared', finding };
    return { code: 'refreshed', finding };
  }

  /**
   * After a snapshot scan, decide what to do about findings the scan did
   * not mention.
   *
   * Absence is weak evidence. It only counts when the scan finished, we
   * retrieved all of it, and it actually reached the asset. Even then one
   * quiet scan is not proof, so a finding has to be missing from
   * `absenceConfirmations` qualifying scans in a row before it is closed.
   */
  reconcileSnapshot(
    scan: SnapshotScan,
    policy: Policy,
    report: (code: AbsenceCode, finding: Finding, obs: SourceObs) => void,
  ): void {
    for (const finding of this.byKey.values()) {
      const obs = finding.obs[scan.source];
      if (!obs) continue;
      if (obs.status !== 'open' && obs.status !== 'absent_pending') continue;
      if (obs.lastSeenCycle === scan.cycle) continue; // reported this scan

      if (policy.requireScanCompleteness) {
        if (!scan.complete) {
          report('held_incomplete_scan', finding, obs);
          continue;
        }
        if (!scan.scannedAssets.has(finding.assetId)) {
          report('held_asset_not_scanned', finding, obs);
          continue;
        }
      }

      obs.missed++;
      if (obs.missed >= policy.absenceConfirmations) {
        obs.status = 'absent_confirmed';
        this.refresh(finding);
        report('absence_confirmed', finding, obs);
      } else {
        obs.status = 'absent_pending';
        this.refresh(finding);
        report('absence_pending', finding, obs);
      }
    }
  }
}
