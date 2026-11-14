import { setAnalyticsChoice, useAnalytics } from '../lib/analytics';
import { useRouter } from '../lib/router';

const DESCRIPTION: Record<string, string> = {
  full: 'On, with cookies. Dreamdata receives your IP address and the pages you view, and stores an identifier in this browser to link your visits.',
  cookieless: 'On, without cookies. Dreamdata receives your IP address and the pages you view; nothing is stored in this browser.',
  off: 'Off. Nothing is loaded from Dreamdata and nothing is sent to it.',
};

/** Asked once, after admission. Until answered, the site stays in whichever mode needs no answer. */
export function AnalyticsConsent() {
  const { ready, configured, choice } = useAnalytics();
  const { path } = useRouter();
  if (!ready || !configured || choice !== null || path === '/admin') return null;
  return (
    <aside className="consent" aria-label="Visit analytics">
      <p>
        <b>One third-party tag runs here.</b> I use Dreamdata to see which companies visit this site. It works at the level of an organization’s
        network, not a person. May it set cookies so repeat visits can be linked?
      </p>
      <div className="consent-actions">
        <button type="button" className="btn btn-primary" onClick={() => setAnalyticsChoice('granted')}>
          Allow
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAnalyticsChoice('declined')}>
          Turn it off
        </button>
      </div>
    </aside>
  );
}

/** The standing control: current state in plain words, and a way to change it. Shown in the privacy notice. */
export function AnalyticsControl() {
  const { ready, configured, choice, mode, privacySignal } = useAnalytics();
  if (!ready || !configured) return null;
  return (
    <div className="consent-control">
      <p>
        <b>Right now:</b> {DESCRIPTION[mode]}
        {mode === 'off' && choice === null && privacySignal ? ' Your browser sends a Global Privacy Control or Do Not Track signal, which is honored.' : ''}
      </p>
      <div className="consent-actions">
        {mode !== 'full' && (
          <button type="button" className="btn btn-ghost" onClick={() => setAnalyticsChoice('granted')}>
            Allow with cookies
          </button>
        )}
        {mode !== 'off' && (
          <button type="button" className="btn btn-ghost" onClick={() => setAnalyticsChoice('declined')}>
            Turn it off
          </button>
        )}
      </div>
    </div>
  );
}
