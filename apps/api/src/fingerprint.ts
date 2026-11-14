import type { FingerprintSubmission, Inconsistency, Signal } from '@portfolio/contracts';
import { firstLanguage, signal, type RequestEvidence } from './evidence';
import type { ParsedUa } from './ua';

/**
 * The opt-in fingerprint: validating what the browser sent, describing
 * each trait honestly, and comparing it with what the server saw.
 *
 * Everything in a submission is a claim from an untrusted client. It is
 * size-limited and type-checked here, and nothing in it is ever executed
 * or echoed anywhere without being treated as text.
 */

const text = (value: unknown, max = 160): string | undefined => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined);
const num = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const flag = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const hash = (value: unknown): string | undefined => (typeof value === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(value) ? value : undefined);

/** Returns null when the submission is not usable at all. */
export function sanitiseSubmission(raw: unknown): FingerprintSubmission | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const libraryHash = hash(input.libraryHash);
  if (!libraryHash) return null;
  const screen = (input.screen ?? {}) as Record<string, unknown>;
  const media = input.mediaDevices as Record<string, unknown> | undefined;
  const storage = input.storage as Record<string, unknown> | undefined;
  const permissions: Record<string, string> = {};
  if (input.permissions && typeof input.permissions === 'object') {
    for (const [name, state] of Object.entries(input.permissions as Record<string, unknown>).slice(0, 12)) {
      const value = text(state, 20);
      if (/^[a-z-]{2,30}$/.test(name) && value) permissions[name] = value;
    }
  }
  const list = (value: unknown, max: number, length: number): string[] | undefined =>
    Array.isArray(value) ? value.map((item) => text(item, length)).filter((item): item is string => item !== undefined).slice(0, max) : undefined;
  return {
    libraryHash,
    libraryVersion: text(input.libraryVersion, 20),
    canvasHash: hash(input.canvasHash),
    webglHash: hash(input.webglHash),
    audioHash: hash(input.audioHash),
    fontsHash: hash(input.fontsHash),
    fontCount: num(input.fontCount, 0, 5000),
    webglVendor: text(input.webglVendor),
    webglRenderer: text(input.webglRenderer),
    timezone: text(input.timezone, 64),
    languages: list(input.languages, 12, 20),
    platform: text(input.platform, 40),
    screen: {
      width: num(screen.width, 0, 20000),
      height: num(screen.height, 0, 20000),
      pixelRatio: num(screen.pixelRatio, 0, 16),
      colorDepth: num(screen.colorDepth, 0, 64),
    },
    hardwareConcurrency: num(input.hardwareConcurrency, 0, 1024),
    deviceMemory: num(input.deviceMemory, 0, 1024),
    maxTouchPoints: num(input.maxTouchPoints, 0, 64),
    doNotTrack: input.doNotTrack === null ? null : text(input.doNotTrack, 12),
    globalPrivacyControl: flag(input.globalPrivacyControl),
    prefersDark: flag(input.prefersDark),
    prefersReducedMotion: flag(input.prefersReducedMotion),
    colorGamut: text(input.colorGamut, 12),
    pdfViewer: flag(input.pdfViewer),
    connectionType: text(input.connectionType, 12),
    mediaDevices: media
      ? { audioInputs: num(media.audioInputs, 0, 64) ?? 0, videoInputs: num(media.videoInputs, 0, 64) ?? 0, audioOutputs: num(media.audioOutputs, 0, 64) ?? 0 }
      : undefined,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
    storage: storage ? { localStorage: flag(storage.localStorage), indexedDb: flag(storage.indexedDb), quotaMb: num(storage.quotaMb, 0, 1e9) } : undefined,
    referrerHost: text(input.referrerHost, 120),
    blocked: list(input.blocked, 30, 40),
  };
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|software|basic render|virtualbox|vmware|parallels/i;

export function buildFingerprintSignals(fp: FingerprintSubmission, fingerprintsOnFile: number): Signal[] {
  const signals: Signal[] = [];
  const script = { source: 'browser script', method: 'script' as const };
  const present = <T>(value: T | undefined | null): value is T => value !== undefined && value !== null;
  const add = (key: string, label: string, value: Signal['value'] | undefined, kind: Signal['kind'], reliability: Signal['reliability'], how: string, note: string): void => {
    signals.push(
      present(value)
        ? signal(key, label, 'device', { value, status: 'claimed', reliability, kind, how, note, ...script })
        : signal(key, label, 'device', { value: null, status: 'unavailable', reliability: 'none', kind: 'gap', how, note: `Not available: the browser withheld or blocked it. ${note}`, ...script }),
    );
  };

  add(
    'fingerprint.id',
    'Browser fingerprint',
    fp.libraryHash,
    'inference',
    'medium',
    `A hash of dozens of browser traits, computed in the page by the open-source ThumbmarkJS library${fp.libraryVersion ? ` (v${fp.libraryVersion})` : ''}.`,
    `Stable across private windows and cleared cookies, which is the point. It is not unique: we hold ${fingerprintsOnFile} distinct fingerprint${fingerprintsOnFile === 1 ? '' : 's'}, and identical devices collide. It identifies a browser configuration, never a person.`,
  );
  add(
    'fingerprint.gpu',
    'Graphics hardware',
    fp.webglRenderer ? `${fp.webglRenderer}${fp.webglVendor && !fp.webglRenderer.includes(fp.webglVendor) ? ` (${fp.webglVendor})` : ''}` : undefined,
    'claim',
    'medium',
    'WebGL exposes the name of the graphics card and driver to any page that asks.',
    `Often names the exact chip, which narrows the device model considerably. Firefox and Safari generalise it; Brave and Tor Browser hide it.${fp.webglRenderer && SOFTWARE_RENDERERS.test(fp.webglRenderer) ? ' This one is a software renderer, typical of virtual machines and headless browsers.' : ''}`,
  );
  add(
    'fingerprint.canvas',
    'Canvas rendering',
    fp.canvasHash,
    'fact',
    'medium',
    'The page draws hidden text and shapes, then hashes the pixels. Graphics hardware, drivers and font rendering all leave marks.',
    'No permission is involved. Brave and Tor Browser add noise so the value changes on every read; Safari and Firefox do so in private windows.',
  );
  add('fingerprint.webgl', 'WebGL rendering', fp.webglHash, 'fact', 'medium', 'The same idea in 3D: render a scene off-screen and hash the result.', 'Shared by every device with the same graphics hardware, driver and browser build.');
  add(
    'fingerprint.audio',
    'Audio processing',
    fp.audioHash,
    'fact',
    'medium',
    'The page generates a silent tone through the audio stack and hashes the output. Nothing is recorded and nothing plays.',
    'Differs by audio hardware and browser engine. Safari 17+ and Brave randomise it.',
  );
  add(
    'fingerprint.fonts',
    'Installed fonts',
    present(fp.fontCount) ? `${fp.fontCount} detected` : undefined,
    'inference',
    'medium',
    'The page measures how wide a test string renders in a list of font names. A different width means the font is installed.',
    'Installed fonts reveal software (design tools, office suites) and language packs. Only fonts on the test list can be detected.',
  );
  add(
    'fingerprint.screen',
    'Screen',
    present(fp.screen?.width) && present(fp.screen.height) ? `${fp.screen.width}×${fp.screen.height}${present(fp.screen.pixelRatio) ? ` at ${fp.screen.pixelRatio}×` : ''}${present(fp.screen.colorDepth) ? `, ${fp.screen.colorDepth}-bit` : ''}` : undefined,
    'claim',
    'medium',
    'window.screen and devicePixelRatio.',
    'Laptop panels are few and well known, so resolution plus pixel ratio often implies a model line. Changes when an external display is connected.',
  );
  add(
    'fingerprint.hardware',
    'Processor and memory',
    present(fp.hardwareConcurrency) ? `${fp.hardwareConcurrency} logical cores${present(fp.deviceMemory) ? `, ~${fp.deviceMemory} GB memory` : ''}` : undefined,
    'claim',
    'low',
    'navigator.hardwareConcurrency and navigator.deviceMemory.',
    'Memory is deliberately rounded to a few coarse values and capped by the browser, and only Chromium reports it. Some browsers cap or fake the core count.',
  );
  add('fingerprint.timezone', 'Time zone', fp.timezone, 'claim', 'medium', 'Intl.DateTimeFormat().resolvedOptions().timeZone: the zone the operating system is set to.', 'Follows the device, not the network, so it survives a VPN. That is why it is compared with the IP location below.');
  add('fingerprint.languages', 'Languages (script)', fp.languages?.join(', '), 'claim', 'medium', 'navigator.languages.', 'Should match the Accept-Language header. A difference means something is rewriting one of them.');
  add('fingerprint.platform', 'Platform (script)', fp.platform, 'claim', 'low', 'navigator.platform or the User-Agent client hints API.', 'Frozen to a generic value in several browsers.');
  add('fingerprint.touch', 'Touch input', fp.maxTouchPoints, 'claim', 'low', 'navigator.maxTouchPoints.', 'Zero on most desktops, five or ten on phones and touch laptops.');
  add(
    'fingerprint.media_devices',
    'Cameras and microphones',
    fp.mediaDevices ? `${fp.mediaDevices.videoInputs} camera${fp.mediaDevices.videoInputs === 1 ? '' : 's'}, ${fp.mediaDevices.audioInputs} microphone${fp.mediaDevices.audioInputs === 1 ? '' : 's'}` : undefined,
    'claim',
    'low',
    'navigator.mediaDevices.enumerateDevices(), which answers without any permission prompt.',
    'Only a count. Device names and the camera or microphone themselves stay locked until you grant permission. Recent browsers report at most one of each before permission.',
  );
  add(
    'fingerprint.preferences',
    'Display preferences',
    [present(fp.prefersDark) ? (fp.prefersDark ? 'dark mode' : 'light mode') : null, fp.prefersReducedMotion ? 'reduced motion' : null, fp.colorGamut ? `${fp.colorGamut} colour` : null].filter(Boolean).join(', ') || undefined,
    'claim',
    'low',
    'CSS media queries, readable from script.',
    'Each is a small trait. Accessibility settings such as reduced motion are uncommon enough to be distinguishing.',
  );
  const permissions = fp.permissions ? Object.entries(fp.permissions).map(([name, state]) => `${name}: ${state}`).join(', ') : undefined;
  add(
    'fingerprint.permissions',
    'Permission states',
    permissions,
    'claim',
    'low',
    'The Permissions API reports whether each capability is granted, denied or would prompt. Asking does not trigger a prompt.',
    'Nothing was requested. "granted" entries would show what this site had already been allowed to use.',
  );
  add('fingerprint.referrer', 'Where you came from', fp.referrerHost, 'claim', 'medium', 'document.referrer: the site whose link you followed.', 'Empty for typed addresses, bookmarks, most apps and links from sites that suppress it.');
  add(
    'fingerprint.connection',
    'Connection quality',
    fp.connectionType,
    'claim',
    'low',
    'The Network Information API (Chromium only).',
    'A rough class such as "4g", estimated by the browser. Not available in Firefox or Safari.',
  );
  if (fp.blocked && fp.blocked.length > 0) {
    signals.push(
      signal('fingerprint.blocked', 'Collectors that got nothing', 'device', {
        value: fp.blocked.join(', '),
        status: 'unavailable',
        reliability: 'none',
        kind: 'gap',
        how: 'Each collector reports when the browser refuses, throws or returns nothing.',
        note: 'A browser that blocks fingerprinting is harder to track and, somewhat ironically, more unusual.',
        ...script,
      }),
    );
  }
  return signals;
}

/** Compare what the script reported with what the server saw and what enrichment inferred. */
export function findInconsistencies(fp: FingerprintSubmission, request: RequestEvidence, ua: ParsedUa, ipTimezone: string | null): Inconsistency[] {
  const found: Inconsistency[] = [];
  if (fp.timezone && ipTimezone && fp.timezone !== ipTimezone) {
    found.push({
      key: 'timezone',
      title: 'Device clock and network are in different places',
      clientSays: `Device time zone: ${fp.timezone}`,
      serverSees: `IP address geolocates to: ${ipTimezone}`,
      reading: 'The usual cause is a VPN or proxy, which moves the network but not the clock. Travel, a manually set zone, or wrong geolocation produce the same thing. Zones that share an offset are also reported here.',
    });
  }
  const headerLanguage = firstLanguage(request.acceptLanguage);
  const scriptLanguage = fp.languages?.[0]?.toLowerCase();
  if (headerLanguage && scriptLanguage && headerLanguage !== scriptLanguage) {
    found.push({
      key: 'language',
      title: 'Language differs between script and request',
      clientSays: `navigator.languages starts with ${scriptLanguage}`,
      serverSees: `Accept-Language starts with ${headerLanguage}`,
      reading: 'Something is rewriting one of them: a privacy extension, a proxy, or automation tooling with a default locale.',
    });
  }
  const platform = fp.platform?.toLowerCase() ?? '';
  const expected: Record<string, RegExp> = { Windows: /win/, macOS: /mac/, iOS: /iphone|ipad|ipod|ios|mac/, Android: /android|linux/, Linux: /linux|x11/, ChromeOS: /cros|chrome|linux/ };
  const pattern = expected[ua.os];
  if (platform && pattern && !pattern.test(platform)) {
    found.push({
      key: 'platform',
      title: 'Operating system differs between script and User-Agent',
      clientSays: `Platform reported by script: ${fp.platform}`,
      serverSees: `User-Agent header implies: ${ua.os}`,
      reading: 'A spoofed User-Agent is the common cause: the header is easy to change and the script-side value is often forgotten.',
    });
  }
  if (fp.maxTouchPoints !== undefined && ua.mobile && fp.maxTouchPoints === 0) {
    found.push({
      key: 'touch',
      title: 'A mobile browser with no touch screen',
      clientSays: 'Touch points: 0',
      serverSees: 'User-Agent header describes a mobile device',
      reading: 'Typical of a desktop browser in device-emulation mode, or a script presenting a mobile User-Agent.',
    });
  }
  return found;
}
