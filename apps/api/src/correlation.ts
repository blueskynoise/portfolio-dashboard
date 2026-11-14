import type { Recognition } from '@portfolio/contracts';
import type { FingerprintRecord } from './store/types';

/**
 * Linking this visit to earlier ones.
 *
 * Three kinds of evidence, in descending strength:
 *
 *   cookie       We wrote an identifier into this browser profile and it
 *                came back. Strong, until cookies are cleared.
 *   fingerprint  The browser's rendering and hardware traits hash to a
 *                value we have seen. Suggestive. Identical devices produce
 *                identical fingerprints, most of all on phones.
 *   context      Same network, same browser family. Weak on its own, but
 *                it changes how much a fingerprint match is worth.
 *
 * The output is always a statement about browsers. Nothing here can show
 * that two visits were made by the same person.
 */

export interface CurrentVisit {
  cookieHash: string | null;
  libraryHash: string;
  canvasHash: string | null;
  webglHash: string | null;
  audioHash: string | null;
  asn: string | null;
  ipPrefix: string | null;
  browserFamily: string;
  osFamily: string;
}

const CAVEAT = 'This links browsers, not people. A shared computer is one browser and many people; one person with a phone and a laptop is two.';

/** Platforms where hardware and software are so uniform that fingerprints routinely collide. */
const lowDiversity = (visit: CurrentVisit): boolean => visit.osFamily === 'iOS' || (visit.osFamily === 'macOS' && visit.browserFamily === 'Safari');

export function correlate(current: CurrentVisit, prior: readonly FingerprintRecord[]): Recognition {
  const byCookie = current.cookieHash ? prior.filter((p) => p.cookieHash === current.cookieHash) : [];
  const byFingerprint = prior.filter((p) => p.libraryHash === current.libraryHash);
  const byCanvas = current.canvasHash ? prior.filter((p) => p.canvasHash === current.canvasHash && p.libraryHash !== current.libraryHash) : [];
  const firstSeen = (records: readonly FingerprintRecord[]): string | null =>
    records.length > 0 ? new Date(Math.min(...records.map((r) => r.createdAt.getTime()))).toISOString() : null;
  const evidence: Recognition['evidence'] = [];

  if (byCookie.length > 0) {
    const latest = byCookie[byCookie.length - 1] as FingerprintRecord;
    const sameFingerprint = latest.libraryHash === current.libraryHash;
    evidence.push({ supports: true, text: `A first-party cookie we set on ${new Date(firstSeen(byCookie) as string).toISOString().slice(0, 10)} came back with this request.` });
    if (sameFingerprint) {
      evidence.push({ supports: true, text: 'The fingerprint matches the one recorded with that cookie.' });
    } else {
      const changed = [
        latest.canvasHash !== current.canvasHash ? 'canvas' : null,
        latest.webglHash !== current.webglHash ? 'WebGL' : null,
        latest.audioHash !== current.audioHash ? 'audio' : null,
      ].filter(Boolean);
      evidence.push({
        supports: false,
        text: `The fingerprint has changed since then${changed.length ? ` (${changed.join(', ')} differ)` : ''}. Browser updates, a new monitor or a settings change all do this. The cookie still carries the link.`,
      });
    }
    if (latest.asn && current.asn) {
      evidence.push({
        supports: latest.asn === current.asn,
        text: latest.asn === current.asn ? 'Same network operator as last time.' : 'Different network operator from last time, which is normal for a laptop or phone.',
      });
    }
    return {
      status: 'recognised',
      confidence: 'high',
      headline: `This browser has been here before: ${byCookie.length} earlier visit${byCookie.length === 1 ? '' : 's'} on record.`,
      evidence,
      priorVisits: byCookie.length,
      firstSeen: firstSeen(byCookie),
      caveat: CAVEAT,
    };
  }

  if (byFingerprint.length > 0) {
    const sameNetwork = byFingerprint.some((p) => (p.ipPrefix !== null && p.ipPrefix === current.ipPrefix) || (p.asn !== null && p.asn === current.asn));
    const uniform = lowDiversity(current);
    evidence.push({ supports: true, text: `An identical fingerprint was recorded ${byFingerprint.length} time${byFingerprint.length === 1 ? '' : 's'} before.` });
    evidence.push({ supports: false, text: 'No cookie links this visit to those. Either cookies were cleared, this is a private window, or it is a different browser.' });
    evidence.push({
      supports: sameNetwork,
      text: sameNetwork ? 'At least one of those visits came from the same network.' : 'None of those visits came from this network.',
    });
    if (uniform) {
      evidence.push({
        supports: false,
        text: `${current.osFamily === 'iOS' ? 'iPhones and iPads' : 'Macs running Safari'} of the same model produce near-identical fingerprints, so a match here is weak evidence.`,
      });
    }
    const strong = sameNetwork && !uniform;
    return {
      status: strong ? 'probable' : 'possible',
      confidence: strong ? 'medium' : 'low',
      headline: strong
        ? 'Probably a returning browser: same fingerprint, same network, no cookie.'
        : 'A browser with this exact fingerprint has visited before. That is not enough to say it was this one.',
      evidence,
      priorVisits: byFingerprint.length,
      firstSeen: firstSeen(byFingerprint),
      caveat: `${strong ? '' : 'Confidence is too low to treat these as the same browser. '}${CAVEAT}`,
    };
  }

  if (byCanvas.length > 0) {
    evidence.push({ supports: true, text: `The canvas rendering matches ${byCanvas.length} earlier visit${byCanvas.length === 1 ? '' : 's'}.` });
    evidence.push({ supports: false, text: 'The overall fingerprint differs. Canvas output is shared by every device with the same graphics hardware, driver and browser build.' });
    return {
      status: 'similar',
      confidence: 'none',
      headline: 'Similar hardware has been seen before. Not enough to link the visits.',
      evidence,
      priorVisits: 0,
      firstSeen: null,
      caveat: `Similarity is not continuity. ${CAVEAT}`,
    };
  }

  return {
    status: 'new',
    confidence: 'none',
    headline: 'No earlier visit matches this browser.',
    evidence: [{ supports: false, text: 'No cookie from us was presented and no stored fingerprint matches.' }],
    priorVisits: 0,
    firstSeen: null,
    caveat: `"New" means new to our ${'records'}, which only go back as far as the retention period. ${CAVEAT}`,
  };
}
