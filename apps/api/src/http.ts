/**
 * Outbound HTTP for provider adapters.
 *
 * Every call has a deadline. A provider that hangs must cost the visitor
 * at most that deadline, and the result has to say what actually happened
 * so a timeout is never recorded as an answer.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type HttpOutcome =
  | { ok: true; status: number; body: unknown; latencyMs: number }
  | { ok: false; kind: 'timeout' | 'network' | 'http' | 'parse'; status?: number; latencyMs: number; detail: string };

export interface HttpOptions {
  timeoutMs: number;
  /** Retry once on a network failure or 5xx. Only for requests that are safe to repeat. */
  retry?: boolean;
  now?: () => number;
}

export async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  options: HttpOptions,
): Promise<HttpOutcome> {
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + options.timeoutMs;
  let last: HttpOutcome | undefined;

  for (let attempt = 1; attempt <= (options.retry ? 2 : 1); attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        last = { ok: false, kind: 'http', status: response.status, latencyMs: now() - started, detail: `HTTP ${response.status}` };
        if (response.status >= 500) continue;
        return last;
      }
      try {
        return { ok: true, status: response.status, body: await response.json(), latencyMs: now() - started };
      } catch {
        return { ok: false, kind: 'parse', status: response.status, latencyMs: now() - started, detail: 'response was not JSON' };
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      last = {
        ok: false,
        kind: aborted ? 'timeout' : 'network',
        latencyMs: now() - started,
        detail: aborted ? `no response within ${options.timeoutMs}ms` : error instanceof Error ? error.message : 'network error',
      };
      if (aborted) return last;
    } finally {
      clearTimeout(timer);
    }
  }
  return last ?? { ok: false, kind: 'timeout', latencyMs: now() - started, detail: `no response within ${options.timeoutMs}ms` };
}

/** A small bounded cache that remembers when each entry was fetched, so staleness can be reported. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): { value: T; ageSeconds: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const age = this.now() - entry.at;
    if (age > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: entry.value, ageSeconds: Math.round(age / 1000) };
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: this.now(), value });
  }
}
