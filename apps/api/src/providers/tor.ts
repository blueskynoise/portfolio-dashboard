import { isIP } from 'node:net';
import type { FetchLike } from '../http';
import type { ProviderCall } from './types';

/**
 * Tor exit relays, from the Tor Project's own published list.
 *
 * The list is fetched on a schedule and held in memory. Two failure modes
 * matter more than a plain outage:
 *
 *   - An empty or tiny response. The real list has around a thousand
 *     entries. A response with a handful is a broken fetch, and treating
 *     it as "there are no Tor exits today" would silently turn every
 *     answer into "not Tor".
 *   - A list that stopped refreshing. The answer is still used, but its
 *     age travels with it so a decision made on old data can be seen.
 */

const PURPOSE = 'Tor exit relay membership';
export const TOR_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const MIN_PLAUSIBLE_ENTRIES = 100;
export const TOR_STALE_AFTER_SECONDS = 6 * 60 * 60;

export class TorExitList {
  readonly name = 'torproject';
  private exits = new Set<string>();
  private fetchedAt: number | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: { fetch: FetchLike; timeoutMs: number; now?: () => number }) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  async refresh(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.options.fetch(TOR_LIST_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = (await response.text()).split('\n').map((line) => line.trim()).filter((line) => isIP(line) !== 0);
      if (entries.length < MIN_PLAUSIBLE_ENTRIES) {
        throw new Error(`implausible list: ${entries.length} entries (expected at least ${MIN_PLAUSIBLE_ENTRIES})`);
      }
      this.exits = new Set(entries);
      this.fetchedAt = this.now();
      this.lastError = null;
      return true;
    } catch (error) {
      // Keep whatever list we already had. Old data with a known age beats no data.
      this.lastError = controller.signal.aborted ? 'timed out' : error instanceof Error ? error.message : 'fetch failed';
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  start(intervalMs = 60 * 60 * 1000): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get size(): number {
    return this.exits.size;
  }

  check(ip: string): ProviderCall<boolean> {
    if (this.fetchedAt === null) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: 'error', latencyMs: 0, detail: `exit list not loaded${this.lastError ? `: ${this.lastError}` : ' yet'}` },
        data: null,
      };
    }
    const ageSeconds = Math.round((this.now() - this.fetchedAt) / 1000);
    const stale = ageSeconds > TOR_STALE_AFTER_SECONDS;
    return {
      result: {
        provider: this.name,
        purpose: PURPOSE,
        status: 'cache',
        latencyMs: 0,
        ageSeconds,
        detail: stale ? `list is stale: last refresh failed (${this.lastError ?? 'unknown'})` : `${this.exits.size} exits in list`,
      },
      data: this.exits.has(ip),
    };
  }
}
