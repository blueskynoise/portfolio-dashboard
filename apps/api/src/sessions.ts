import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens.
 *
 * The cookie holds a signed pointer, not the session itself: an id, the
 * assessment that earned it, and an expiry, with an HMAC over all three.
 * The signature stops tampering; the server-side session row is what lets
 * a session be revoked or tied to the browser it was issued to.
 */

export interface TokenPayload {
  /** Session id, or "admin" for the administrative cookie. */
  sid: string;
  /** Assessment id that authorized this session. */
  aid: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export type TokenFailure = 'missing' | 'malformed' | 'bad_signature' | 'expired';

const sign = (body: string, secret: string): Buffer => createHmac('sha256', secret).update(body).digest();

export function issueToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret).toString('base64url')}`;
}

export function verifyToken(token: string | undefined, secret: string, nowMs: number): { ok: true; payload: TokenPayload } | { ok: false; reason: TokenFailure } {
  if (!token) return { ok: false, reason: 'missing' };
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = sign(body, secret);
  const presented = Buffer.from(signature, 'base64url');
  // Compare in constant time, and check the signature before reading anything from the body.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return { ok: false, reason: 'bad_signature' };
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const candidate = payload as Partial<TokenPayload> | null;
  if (!candidate || typeof candidate.sid !== 'string' || typeof candidate.aid !== 'string' || typeof candidate.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (candidate.exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, payload: { sid: candidate.sid, aid: candidate.aid, exp: candidate.exp } };
}

export const newId = (): string => randomBytes(18).toString('base64url');

/** A fingerprint of the User-Agent only: enough to notice a cookie being replayed from a different client. */
export const hashUserAgent = (userAgent: string | undefined): string =>
  createHash('sha256').update(userAgent ?? '').digest('hex').slice(0, 32);

export const hashOpaque = (value: string, secret: string): string => createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
