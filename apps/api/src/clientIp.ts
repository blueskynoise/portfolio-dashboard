import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { ClientIpSource } from './config';

/**
 * Working out who we are actually talking to.
 *
 * Every forwarding header is attacker-controlled unless a proxy we trust
 * wrote it. So the source of the client address is a configuration
 * decision made once per deployment, never a best-effort guess across
 * whichever headers happen to be present.
 */

export interface ResolvedIp {
  ip: string | null;
  /** How the address was established, for the evidence record. */
  method: string;
}

export interface IpInputs {
  socketAddress: string | undefined;
  header: (name: string) => string | undefined;
}

const normalise = (value: string | undefined): string | null => {
  if (!value) return null;
  let candidate = value.trim();
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  return isIP(candidate) ? candidate.toLowerCase() : null;
};

export function resolveClientIp(source: ClientIpSource, hops: number, inputs: IpInputs): ResolvedIp {
  if (source === 'socket') {
    return { ip: normalise(inputs.socketAddress), method: 'TCP peer address (no proxy trusted)' };
  }
  if (source === 'x-real-ip') {
    // Set by the platform edge. Anything the client sent under this name is overwritten there.
    return { ip: normalise(inputs.header('x-real-ip')), method: 'X-Real-IP set by the platform edge' };
  }
  // X-Forwarded-For is appended to by each proxy. A client can pre-fill the
  // left-hand side with anything, so only the entries written by proxies we
  // trust count: the address we want is `hops` from the right.
  const chain = (inputs.header('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const candidate = chain[chain.length - hops];
  return {
    ip: normalise(candidate),
    method: `X-Forwarded-For, ${hops} trusted ${hops === 1 ? 'hop' : 'hops'} from the right`,
  };
}

/** Addresses that are not routable on the public internet: nothing to enrich. */
export function isPublicIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return false;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // unique local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return false; // link local
  return true;
}

/** The form we store: enough to see patterns, not enough to single out a household. */
export function truncateIp(ip: string): string {
  if (isIP(ip) === 4) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  const groups = expandIpv6(ip).slice(0, 3);
  return `${groups.join(':')}::/48`;
}

function expandIpv6(ip: string): string[] {
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0');
  return [...left, ...(ip.includes('::') ? fill : []), ...right];
}

/** Keyed hash: lets us count and rate-limit by address without storing the address. */
export function hmacIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}
