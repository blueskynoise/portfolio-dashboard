import type { FindingStore } from './store';
import type { World } from './types';

/**
 * The simulation knows the ground truth, so it can mark its own homework.
 *
 * The one mistake that must never happen is closing something that still
 * exists. The opposite error, keeping something open a little too long,
 * is the price of being careful and is counted separately.
 */

export interface Verification {
  cycle: number;
  /** Really present, but the pipeline closed it. The dangerous kind of wrong. */
  wronglyClosed: string[];
  /** Really gone, but the pipeline has not confirmed that yet. The safe kind of wrong. */
  awaitingConfirmation: number;
  /** Really present and the pipeline has it open. */
  correctlyOpen: number;
  /** Really present, but no source has managed to tell us yet. */
  notYetObserved: number;
}

export function verifyAgainstTruth(world: World, store: FindingStore, cycle: number): Verification {
  const result: Verification = {
    cycle,
    wronglyClosed: [],
    awaitingConfirmation: 0,
    correctlyOpen: 0,
    notYetObserved: 0,
  };
  for (const truth of world.truth) {
    const finding = store.get(truth.key);
    const reallyPresent = truth.active[cycle - 1] ?? false;
    if (reallyPresent) {
      if (!finding) result.notYetObserved++;
      else if (finding.status === 'resolved') result.wronglyClosed.push(truth.key);
      else result.correctlyOpen++;
    } else if (finding && finding.status !== 'resolved') {
      result.awaitingConfirmation++;
    }
  }
  return result;
}
