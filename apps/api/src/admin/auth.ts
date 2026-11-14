import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Administrator password hashing (scrypt).
 *
 * The hash, not the password, goes in the environment. Format:
 *   scrypt:<N>:<salt hex>:<hash hex>
 *
 * Colons rather than the conventional dollar signs, because a dollar sign
 * in an environment file is read as variable interpolation by several tools.
 */
const N = 16384;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N });
  return ['scrypt', N, salt.toString('hex'), hash.toString('hex')].join(':');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, cost, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !cost || !saltHex || !hashHex) return false;
  const costNumber = Number(cost);
  if (!Number.isInteger(costNumber) || costNumber < 1024 || costNumber > 1 << 20) return false;
  try {
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: costNumber });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
