/**
 * Retry logic for the simulated source APIs.
 *
 * Time is virtual: nothing actually sleeps. Delays are added up and
 * reported, which keeps the simulation instant and the tests exact.
 */

export type HttpResult<T> =
  | { status: 200; body: T }
  | { status: 429; retryAfterMs: number }
  | { status: 503 };

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 8000 };

export interface AttemptLog {
  attempt: number;
  status: 200 | 429 | 503;
  /** How long we waited after this attempt before trying again. */
  waitMs: number;
}

export interface FetchOutcome<T> {
  ok: boolean;
  body?: T;
  attempts: AttemptLog[];
  waitedMs: number;
}

/** Exponential backoff with "equal jitter": half fixed, half random. */
export function backoffDelay(attempt: number, policy: RetryPolicy, jitter: number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + (ceiling / 2) * jitter);
}

/**
 * Call `request` until it succeeds or the attempt budget runs out.
 *
 * - 429: the server told us when to come back, so wait exactly that long.
 *        Guessing a shorter delay is how a rate limit becomes a ban.
 * - 503: back off exponentially with jitter.
 * - Budget exhausted: report failure. The caller decides what that means;
 *   this function never pretends a failed page was an empty one.
 */
export function fetchWithRetry<T>(
  request: (attempt: number) => HttpResult<T>,
  policy: RetryPolicy,
  jitter: () => number,
): FetchOutcome<T> {
  const attempts: AttemptLog[] = [];
  let waitedMs = 0;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const result = request(attempt);
    if (result.status === 200) {
      attempts.push({ attempt, status: 200, waitMs: 0 });
      return { ok: true, body: result.body, attempts, waitedMs };
    }
    const isLast = attempt === policy.maxAttempts;
    const waitMs = isLast
      ? 0
      : result.status === 429
        ? result.retryAfterMs
        : backoffDelay(attempt, policy, jitter());
    attempts.push({ attempt, status: result.status, waitMs });
    waitedMs += waitMs;
  }
  return { ok: false, attempts, waitedMs };
}
