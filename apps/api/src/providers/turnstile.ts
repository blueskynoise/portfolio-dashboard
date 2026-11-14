import { randomUUID } from 'node:crypto';
import type { BotVerification } from '@portfolio/policy';
import { requestJson, type FetchLike } from '../http';
import type { ProviderCall } from './types';

/**
 * Cloudflare Turnstile: server-side validation of the browser's token.
 *
 * The widget in the page only produces a token. The token means nothing
 * until this call succeeds, which is why the result of *this* request is
 * the signal, never anything the browser says about the widget.
 */

const PURPOSE = 'Bot verification';
export const TURNSTILE_ACTION = 'gate';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface BotCheck {
  outcome: BotVerification;
  errorCodes: string[];
}

export class TurnstileProvider {
  readonly name = 'turnstile';

  constructor(
    private readonly options: { siteKey?: string; secretKey?: string; expectedHostname?: string; fetch: FetchLike; timeoutMs: number; now?: () => number },
  ) {}

  get configured(): boolean {
    return Boolean(this.options.siteKey && this.options.secretKey);
  }

  get siteKey(): string | undefined {
    return this.configured ? this.options.siteKey : undefined;
  }

  async verify(token: string | undefined, remoteIp: string | null): Promise<ProviderCall<BotCheck>> {
    const { secretKey, expectedHostname, fetch, timeoutMs, now } = this.options;
    if (!this.configured || !secretKey) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: 'unconfigured', latencyMs: 0, detail: 'TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY are not set' },
        data: { outcome: 'unconfigured', errorCodes: [] },
      };
    }
    if (!token) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: 'skipped', latencyMs: 0, detail: 'no token presented' },
        data: { outcome: 'missing', errorCodes: [] },
      };
    }
    if (token.length > 2048) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: 'skipped', latencyMs: 0, detail: 'token exceeds maximum length' },
        data: { outcome: 'failed', errorCodes: ['invalid-input-response'] },
      };
    }

    const outcome = await requestJson(
      fetch,
      SITEVERIFY,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The idempotency key makes the single retry safe: a repeat is the same validation, not a replay.
        body: JSON.stringify({ secret: secretKey, response: token, remoteip: remoteIp ?? undefined, idempotency_key: randomUUID() }),
      },
      { timeoutMs, retry: true, now },
    );
    if (!outcome.ok) {
      return {
        result: { provider: this.name, purpose: PURPOSE, status: outcome.kind === 'timeout' ? 'timeout' : 'error', latencyMs: outcome.latencyMs, detail: outcome.detail },
        data: { outcome: 'provider_error', errorCodes: [] },
      };
    }

    const body = (outcome.body ?? {}) as { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown };
    const errorCodes = Array.isArray(body['error-codes']) ? body['error-codes'].filter((code): code is string => typeof code === 'string') : [];
    const base = { provider: this.name, purpose: PURPOSE, latencyMs: outcome.latencyMs };

    if (typeof body.success !== 'boolean') {
      return { result: { ...base, status: 'error', detail: 'unexpected response shape' }, data: { outcome: 'provider_error', errorCodes } };
    }
    if (errorCodes.includes('internal-error')) {
      return { result: { ...base, status: 'error', detail: 'provider reported internal-error' }, data: { outcome: 'provider_error', errorCodes } };
    }
    if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('missing-input-secret')) {
      // Our misconfiguration, not the visitor's failure.
      return { result: { ...base, status: 'error', detail: 'provider rejected our secret key' }, data: { outcome: 'provider_error', errorCodes } };
    }
    if (!body.success) {
      return { result: { ...base, status: 'ok', detail: `rejected: ${errorCodes.join(', ') || 'no reason given'}` }, data: { outcome: 'failed', errorCodes } };
    }
    // A valid token for a different widget or site is not a pass for this one.
    if (body.action !== TURNSTILE_ACTION) {
      return { result: { ...base, status: 'ok', detail: 'token was issued for a different action' }, data: { outcome: 'failed', errorCodes: ['action-mismatch'] } };
    }
    if (expectedHostname && body.hostname !== expectedHostname) {
      return { result: { ...base, status: 'ok', detail: 'token was issued for a different hostname' }, data: { outcome: 'failed', errorCodes: ['hostname-mismatch'] } };
    }
    return { result: { ...base, status: 'ok', detail: 'token validated' }, data: { outcome: 'passed', errorCodes: [] } };
  }
}
