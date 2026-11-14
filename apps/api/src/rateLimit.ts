/**
 * Sliding-window counters, held in memory.
 *
 * Good enough for a single instance, which is what this service runs as.
 * With more than one replica these would need to move to shared storage,
 * otherwise each replica would allow its own full quota.
 */
export class SlidingCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  /** Record an event and return how many have happened in the window, including this one. */
  hit(key: string): number {
    const kept = this.recent(key);
    kept.push(this.now());
    this.hits.set(key, kept);
    return kept.length;
  }

  count(key: string): number {
    return this.recent(key).length;
  }

  /** Seconds until the oldest event in the window expires. */
  retryAfterSeconds(key: string): number {
    const oldest = this.recent(key)[0];
    return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }

  get keys(): number {
    return this.hits.size;
  }
}
