import { useSyncExternalStore } from 'react';
import type { GateConfig } from '@portfolio/contracts';
import { api } from './api';

/**
 * Company-level visit analytics (Dreamdata).
 *
 * The one third-party tag on the site, so it is kept on a short lead:
 *  - it loads only inside the admitted site, never on the gate, and never on /admin;
 *  - "full" mode (cookies, a stored visitor id) needs an explicit yes;
 *  - before a choice, the vendor's cookieless mode sends page views with nothing stored on the device,
 *    and not at all when the browser sends Global Privacy Control or Do Not Track;
 *  - "off" means nothing is loaded.
 *
 * This is the vendor's install snippet rewritten as module code: the page's script policy forbids inline
 * scripts, so the snippet cannot be pasted into the HTML. Form tracking is left off on purpose, because the
 * only form on the site is the administrator's sign-in.
 */

export type Choice = 'granted' | 'declined' | null;
export type Mode = 'off' | 'cookieless' | 'full';
type Settings = GateConfig['visitorAnalytics'];

export interface AnalyticsState {
  ready: boolean;
  configured: boolean;
  choice: Choice;
  /** What this visitor's settings call for. */
  mode: Mode;
  /** True when the browser's own privacy signal is the reason nothing runs. */
  privacySignal: boolean;
}

const STORAGE_KEY = 'pd_analytics';
const METHODS = ['trackSubmit', 'trackClick', 'trackLink', 'trackForm', 'pageview', 'identify', 'reset', 'group', 'track', 'ready', 'alias', 'debug', 'page', 'screen', 'once', 'off', 'on', 'addSourceMiddleware', 'addIntegrationMiddleware', 'setAnonymousId', 'addDestinationMiddleware', 'register'];
const WITH_PAGE_CONTEXT = ['track', 'screen', 'alias', 'group', 'page', 'identify'];
const VARIANT = {
  full: { global: 'dreamdata', scriptId: 'dreamdata-analytics', keyAttribute: 'data-global-dreamdata-analytics-key', src: 'https://cdn.dreamdata.cloud/scripts/analytics/next/dreamdata.min.js', version: 'dreamdata-2.2.6' },
  cookieless: { global: 'dreamdata-cl', scriptId: 'dreamdata-analytics-cl', keyAttribute: 'data-global-dreamdata-cl-analytics-key', src: 'https://cdn.drda.io/scripts/analytics/next/dreamdata.cl.min.js', version: 'dreamdata-cl-2.0.0' },
} as const;

type Queue = unknown[][] & Record<string, unknown>;
const globals = window as unknown as Record<string, Queue | undefined>;

function readChoice(): Choice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'granted' || value === 'declined' ? value : null;
  } catch {
    return null;
  }
}

function browserPrivacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}

/** Pure, so the rules can be read in one place. */
export function decideMode(settings: Pick<Settings, 'configured' | 'cookieless'>, choice: Choice, privacySignal: boolean): Mode {
  if (!settings.configured || choice === 'declined') return 'off';
  if (choice === 'granted') return 'full';
  return settings.cookieless && !privacySignal ? 'cookieless' : 'off';
}

let state: AnalyticsState = { ready: false, configured: false, choice: readChoice(), mode: 'off', privacySignal: browserPrivacySignal() };
let settings: Settings | null = null;
let loaded: Mode = 'off';
let started = false;
const listeners = new Set<() => void>();

function publish(next: Partial<AnalyticsState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

const onAdmin = (): boolean => window.location.pathname.startsWith('/admin');

function load(variant: 'full' | 'cookieless', writeKey: string): void {
  const v = VARIANT[variant];
  const existing = globals[v.global];
  if (existing && (existing.initialize || existing.invoked)) return;
  const queue = (globals[v.global] = (existing ?? []) as Queue);
  queue.invoked = true;
  queue.methods = METHODS;
  for (const method of METHODS) {
    queue[method] = (...args: unknown[]) => {
      const live = globals[v.global] as Queue & Record<string, (...a: unknown[]) => unknown>;
      if (live.initialized) return live[method]?.(...args);
      if (WITH_PAGE_CONTEXT.includes(method)) {
        const canonical = document.querySelector("link[rel='canonical']");
        args.push({ __t: 'bpc', c: canonical?.getAttribute('href') ?? undefined, p: location.pathname, u: location.href, s: location.search, t: document.title, r: document.referrer });
      }
      queue.push([method, ...args]);
      return queue;
    };
  }
  queue._writeKey = writeKey;
  queue.SNIPPET_VERSION = v.version;
  if (variant === 'full') queue._loadOptions = { googleEnhancedConversions: false, intentSources: false };

  const script = document.createElement('script');
  script.id = v.scriptId;
  script.type = 'text/javascript';
  script.async = true;
  script.setAttribute(v.keyAttribute, v.global);
  script.src = v.src;
  document.head.appendChild(script);
  loaded = variant;
}

function call(method: string): void {
  if (loaded === 'off') return;
  const queue = globals[VARIANT[loaded].global] as (Queue & Record<string, (() => unknown) | undefined>) | undefined;
  try {
    queue?.[method]?.();
  } catch {
    // Analytics never gets to break the page.
  }
}

function apply(): void {
  if (!settings) return;
  const mode = decideMode(settings, state.choice, state.privacySignal);
  publish({ ready: true, configured: settings.configured, mode });
  if (mode === 'off' || loaded !== 'off' || onAdmin() || !settings.writeKey) return;
  load(mode, settings.writeKey);
  call('page');
}

/** Called once, after admission. Fails closed: if the configuration cannot be read, nothing loads. */
export function startAnalytics(): void {
  if (started) return;
  started = true;
  // The vendor script writes a few keys back as the page unloads, so "off" is enforced again on arrival.
  if (state.choice === 'declined') forgetVendorStorage();
  api
    .get<GateConfig>('/api/gate/config')
    .then((config) => {
      settings = config.visitorAnalytics;
      apply();
    })
    .catch(() => publish({ ready: true }));
}

/** Record a view of the current page. A no-op until something is loaded, and always on /admin. */
export function trackPage(): void {
  if (onAdmin()) return;
  if (loaded === 'off') {
    // The first page is recorded by apply(); after that, a visitor arriving from /admin may still need a load.
    if (settings) apply();
    return;
  }
  call('page');
}

/** The vendor's own reset leaves a few keys behind. "Off" should leave nothing of theirs in this browser. */
function forgetVendorStorage(): void {
  const theirs = (name: string): boolean => name.startsWith('dd_') || name.startsWith('ajs_');
  try {
    Object.keys(window.localStorage).filter(theirs).forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim() ?? '';
    if (theirs(name)) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

export function setAnalyticsChoice(choice: Exclude<Choice, null>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Without storage the choice lasts for this page only.
  }
  const wanted = settings ? decideMode(settings, choice, state.privacySignal) : 'off';
  if (loaded !== 'off' && wanted !== loaded) {
    // A script that is already running cannot be unloaded. Clear what it stored, then start clean.
    if (loaded === 'full') {
      call('reset');
      forgetVendorStorage();
    }
    window.location.reload();
    return;
  }
  publish({ choice });
  apply();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useAnalytics(): AnalyticsState {
  return useSyncExternalStore(subscribe, () => state);
}
