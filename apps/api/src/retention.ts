import type { Store } from './store/types';

/**
 * Retention: delete what is older than the stated period.
 *
 * Runs at boot and then hourly. The period shown to visitors in the
 * privacy notice is this same configuration value, so the notice cannot
 * promise something the job does not do.
 */
export async function runRetention(store: Store, retentionDays: number, now: number, log: (message: string, data: object) => void): Promise<void> {
  const cutoff = new Date(now - retentionDays * 86_400_000);
  try {
    const purged = await store.purgeOlderThan(cutoff);
    if (purged.assessments + purged.events > 0) log('retention purge', { cutoff: cutoff.toISOString(), ...purged });
  } catch (error) {
    log('retention purge failed', { error: error instanceof Error ? error.message : 'unknown' });
  }
}
