/**
 * A per-day call budget for a metered provider.
 *
 * Free tiers are measured per day, and a scraper hammering the gate must
 * not be able to burn through one. When the budget is gone the adapter
 * reports "skipped: budget exhausted" and the signal becomes unknown; it
 * does not quietly keep calling and it does not make something up.
 */
export class DailyBudget {
  private day = '';
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one call from today's budget. Returns false when there is none left. */
  take(): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
}
