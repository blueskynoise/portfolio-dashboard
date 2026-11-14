/**
 * Loads Cloudflare Turnstile and returns a token.
 *
 * The token proves nothing by itself. It is sent to our server, which
 * asks Cloudflare whether it is genuine. Only that answer is evidence.
 */

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile did not initialize')));
    script.onerror = () => reject(new Error('turnstile script blocked or unreachable'));
    document.head.appendChild(script);
  });
  return loading;
}

export interface TokenResult {
  token?: string;
  /** Why there is no token, when there is not. */
  problem?: string;
}

/**
 * `visible` shows the widget whether or not it needs interaction, for the
 * explicit challenge step. Otherwise it appears only if Cloudflare wants
 * the visitor to do something.
 */
export async function obtainToken(container: HTMLElement, siteKey: string, visible: boolean, timeoutMs = 20_000): Promise<TokenResult> {
  let api: TurnstileApi;
  try {
    api = await load();
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'could not load verification' };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TokenResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish({ problem: 'verification did not complete in time' }), timeoutMs);
    container.replaceChildren();
    api.render(container, {
      sitekey: siteKey,
      action: 'gate',
      theme: 'light',
      size: 'flexible',
      appearance: visible ? 'always' : 'interaction-only',
      callback: (token: string) => finish({ token }),
      'error-callback': () => finish({ problem: 'verification reported an error' }),
      'expired-callback': () => finish({ problem: 'verification expired' }),
    });
  });
}
