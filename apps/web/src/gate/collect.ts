import type { ClientEvidence, FingerprintSubmission } from '@portfolio/contracts';

/**
 * In-page collectors.
 *
 * Two tiers, kept strictly apart:
 *
 *   baseline()     a handful of low-entropy facts used for the access
 *                  decision. Runs for everyone.
 *   fingerprint()  canvas, WebGL, audio, fonts and hardware traits. Runs
 *                  only after the visitor opts in.
 *
 * Nothing here asks for a permission, and nothing here can read what the
 * browser protects: history, other tabs, files, precise location.
 */

interface UaData {
  platform?: string;
  mobile?: boolean;
  brands?: { brand: string; version: string }[];
}

export function baseline(): ClientEvidence {
  const nav = navigator as Navigator & { userAgentData?: UaData };
  return {
    userAgent: nav.userAgent,
    secureContext: window.isSecureContext,
    cookiesEnabled: nav.cookieEnabled,
    webdriver: nav.webdriver === true,
    languages: [...(nav.languages ?? [])],
    uaData: nav.userAgentData
      ? { platform: nav.userAgentData.platform, mobile: nav.userAgentData.mobile, brands: nav.userAgentData.brands?.map((b) => `${b.brand} ${b.version}`) }
      : undefined,
    capabilities: {
      webCrypto: typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined',
      webAuthn: typeof window.PublicKeyCredential !== 'undefined',
      serviceWorker: 'serviceWorker' in nav,
    },
  };
}

async function sha(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null) return undefined;
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Components = Record<string, unknown>;
const record = (value: unknown): Components | undefined => (value && typeof value === 'object' ? (value as Components) : undefined);

function webglInfo(): { vendor?: string; renderer?: string } {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return {};
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    };
  } catch {
    return {};
  }
}

const PERMISSIONS = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read'] as const;

export async function fingerprint(): Promise<FingerprintSubmission> {
  const blocked: string[] = [];
  const attempt = async <T>(name: string, read: () => T | Promise<T>): Promise<T | undefined> => {
    try {
      const value = await read();
      if (value === undefined || value === null || value === '') blocked.push(name);
      return value ?? undefined;
    } catch {
      blocked.push(name);
      return undefined;
    }
  };

  // The open-source library does the heavy rendering work. It is configured to stay entirely local:
  // no API key, no logging, no beacon. The page's Content-Security-Policy would block those requests anyway.
  const { getThumbmark, getVersion } = await import('@thumbmarkjs/thumbmarkjs');
  const result = await getThumbmark({ logging: false, collect_beacon: false, timeout: 4000 });
  const components = (result.components ?? {}) as Components;

  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string }; pdfViewerEnabled?: boolean; globalPrivacyControl?: boolean; userAgentData?: UaData };
  const gpu = webglInfo();
  if (!gpu.renderer) blocked.push('webgl-renderer');
  const fonts = record(components.fonts);

  const permissions: Record<string, string> = {};
  if (navigator.permissions?.query) {
    for (const name of PERMISSIONS) {
      try {
        permissions[name] = (await navigator.permissions.query({ name: name as PermissionName })).state;
      } catch {
        // Not every browser knows every permission name. That is an absence, not a failure.
      }
    }
  } else blocked.push('permissions');

  const devices = await attempt('media-devices', async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    const count = (kind: MediaDeviceKind): number => list.filter((d) => d.kind === kind).length;
    return { audioInputs: count('audioinput'), videoInputs: count('videoinput'), audioOutputs: count('audiooutput') };
  });
  const quota = await attempt('storage', async () => {
    const estimate = await navigator.storage.estimate();
    return estimate.quota ? Math.round(estimate.quota / 1_048_576) : undefined;
  });
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).host : undefined;
    if (referrerHost === location.host) referrerHost = undefined;
  } catch {
    referrerHost = undefined;
  }
  const media = (query: string): boolean => window.matchMedia(query).matches;

  return {
    libraryHash: result.thumbmark,
    libraryVersion: getVersion(),
    canvasHash: await attempt('canvas', () => sha(components.canvas)),
    webglHash: await attempt('webgl', () => sha(components.webgl)),
    audioHash: await attempt('audio', () => sha(components.audio)),
    fontsHash: await attempt('fonts', () => sha(components.fonts)),
    fontCount: fonts ? Object.keys(fonts).length : undefined,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: [...(nav.languages ?? [])],
    platform: nav.userAgentData?.platform ?? nav.platform,
    screen: { width: screen.width, height: screen.height, pixelRatio: window.devicePixelRatio, colorDepth: screen.colorDepth },
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    maxTouchPoints: nav.maxTouchPoints,
    doNotTrack: nav.doNotTrack ?? null,
    globalPrivacyControl: nav.globalPrivacyControl,
    prefersDark: media('(prefers-color-scheme: dark)'),
    prefersReducedMotion: media('(prefers-reduced-motion: reduce)'),
    colorGamut: media('(color-gamut: rec2020)') ? 'rec2020' : media('(color-gamut: p3)') ? 'p3' : 'srgb',
    pdfViewer: nav.pdfViewerEnabled,
    connectionType: nav.connection?.effectiveType,
    mediaDevices: devices,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
    storage: { localStorage: (() => { try { return typeof localStorage !== 'undefined'; } catch { return false; } })(), indexedDb: 'indexedDB' in window, quotaMb: quota },
    referrerHost,
    blocked,
  };
}
