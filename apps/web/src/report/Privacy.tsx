import type { GateConfig } from '@portfolio/contracts';

export function PrivacyNotice({ config }: { config: GateConfig | null }) {
  const days = config?.retentionDays ?? 30;
  const hours = Math.round((config?.sessionTtlMinutes ?? 480) / 60);
  return (
    <div className="privacy">
      <h3>What this site does with your visit</h3>
      <p>
        This portfolio is fronted by a working access gateway, built as a demonstration. It evaluates each connection before the site
        loads, and it shows you the result.
      </p>
      <h4>Always, for security</h4>
      <ul>
        <li>Your IP address, request headers and a few browser capabilities are used to make an access decision.</li>
        <li>
          Your IP address is sent to the enrichment providers listed below, and to Cloudflare for bot verification where configured.
        </li>
        <li>A session cookie keeps you admitted for up to {hours} hours. It is essential and holds no personal data.</li>
      </ul>
      <h4>Only if you opt in</h4>
      <ul>
        <li>A browser fingerprint (canvas, WebGL, audio, fonts, hardware traits), stored as keyed hashes.</li>
        <li>A first-party cookie, kept for 90 days, used to recognize a returning browser.</li>
        <li>You can delete both at any time from the “Your evaluation” page.</li>
      </ul>
      <h4>What is kept</h4>
      <ul>
        <li>
          Evaluation records are kept for {days} days and then deleted. Your address is stored truncated (the last part removed) and as
          a keyed hash; the full address and full User-Agent string are not stored.
        </li>
        <li>There is no advertising, no analytics service and no third-party tracking tag.</li>
        <li>The site owner can see aggregate statistics and organization-level network attribution. Nothing here identifies you personally.</li>
      </ul>
      {config && (
        <>
          <h4>Providers on this deployment</h4>
          <ul className="privacy-providers">
            {config.providers.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b> <span className={`chip ${p.configured ? 'chip-good' : ''}`}>{p.configured ? 'active' : 'not configured'}</span>
                <br />
                {p.purpose}. {p.note}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Bot verification by Cloudflare Turnstile</h4>
      <p>
        Where it is configured, this site uses Cloudflare Turnstile in invisible mode to tell browsers from automated clients. It runs in the
        background with no visible widget. Cloudflare collects and processes data from your browser to do this, as described in{' '}
        <a className="text-link" href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener noreferrer">
          Cloudflare’s Turnstile Privacy Addendum
        </a>
        .
      </p>
      <p>Questions or a deletion request: hello@markgraziano.com.</p>
    </div>
  );
}
