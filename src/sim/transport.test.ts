import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_RETRY, fetchWithRetry, type HttpResult } from './transport';

const scripted = <T>(responses: HttpResult<T>[]) => (attempt: number): HttpResult<T> => {
  const response = responses[Math.min(attempt, responses.length) - 1];
  if (!response) throw new Error('no scripted response');
  return response;
};

describe('fetchWithRetry', () => {
  it('returns immediately on success without waiting', () => {
    const outcome = fetchWithRetry(scripted([{ status: 200, body: 'ok' }]), DEFAULT_RETRY, () => 0.5);
    expect(outcome).toMatchObject({ ok: true, body: 'ok', waitedMs: 0 });
    expect(outcome.attempts).toHaveLength(1);
  });

  it('waits exactly as long as a 429 asks, not a guess of its own', () => {
    const outcome = fetchWithRetry(
      scripted<string>([
        { status: 429, retryAfterMs: 2500 },
        { status: 429, retryAfterMs: 1000 },
        { status: 200, body: 'ok' },
      ]),
      DEFAULT_RETRY,
      () => 0.99,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts.map((a) => a.waitMs)).toEqual([2500, 1000, 0]);
    expect(outcome.waitedMs).toBe(3500);
  });

  it('backs off exponentially on 503 and recovers', () => {
    const outcome = fetchWithRetry(
      scripted<string>([{ status: 503 }, { status: 503 }, { status: 200, body: 'ok' }]),
      DEFAULT_RETRY,
      () => 1,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts.map((a) => a.waitMs)).toEqual([500, 1000, 0]);
  });

  it('gives up after the attempt budget and reports failure, never an empty success', () => {
    let calls = 0;
    const outcome = fetchWithRetry<string>(
      () => {
        calls++;
        return { status: 503 };
      },
      DEFAULT_RETRY,
      () => 0,
    );
    expect(calls).toBe(DEFAULT_RETRY.maxAttempts);
    expect(outcome.ok).toBe(false);
    expect(outcome.body).toBeUndefined();
    // No pointless wait after the final attempt.
    expect(outcome.attempts.at(-1)?.waitMs).toBe(0);
  });
});

describe('backoffDelay', () => {
  it('stays within half and full of the capped exponential ceiling', () => {
    for (let attempt = 1; attempt <= 8; attempt++) {
      const ceiling = Math.min(DEFAULT_RETRY.maxDelayMs, DEFAULT_RETRY.baseDelayMs * 2 ** (attempt - 1));
      expect(backoffDelay(attempt, DEFAULT_RETRY, 0)).toBe(ceiling / 2);
      expect(backoffDelay(attempt, DEFAULT_RETRY, 1)).toBe(ceiling);
    }
  });
});
