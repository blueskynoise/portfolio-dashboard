import { useEffect, useState } from 'react';
import type { AssessmentReport, GateConfig, PolicyDocument } from '@portfolio/contracts';
import { Contact } from '../components/Chrome';
import { profile } from '../content/site';
import { api } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { Ext } from '../lib/router';
import { Beyond } from '../report/Beyond';
import { DecisionBanner, Providers, Reasons, Rules, Stages } from '../report/Decision';
import { FingerprintPanel } from '../report/Fingerprint';
import { PrivacyNotice } from '../report/Privacy';
import { SignalGroups, summarise } from '../report/Signals';

const FLOW: [string, string][] = [
  ['Request arrives', 'The server decides which forwarding header to believe from configuration, never from whichever headers are present. A client-supplied X-Forwarded-For is ignored.'],
  ['No session', 'Any page request without a valid session receives the gate and nothing else. The portfolio’s code and content are separate files that are refused without a session.'],
  ['Evidence', 'Request headers, a few facts from the page script, and enrichment of the address from providers, each with a timeout, a cache and a daily budget.'],
  ['Bot verification', 'The page obtains a Turnstile token. The server validates it with Cloudflare; only that server-side answer counts.'],
  ['Policy', 'A versioned, pure function turns facts into ALLOW, CHALLENGE or DENY with reason codes. Unknown facts make a rule "not evaluable"; they never count as passing.'],
  ['Record, then admit', 'The decision is written to Postgres first. Only then is a signed, HTTP-only session cookie issued. If the write fails, nobody is admitted.'],
  ['Every later request', 'The cookie’s signature, expiry, revocation and the browser it was issued to are checked before anything protected is served.'],
];

export function Access() {
  useDocumentTitle(`Your evaluation — ${profile.name}`);
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [config, setConfig] = useState<GateConfig | null>(null);
  const [policy, setPolicy] = useState<PolicyDocument | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.get<AssessmentReport>('/api/me/assessment'), api.get<GateConfig>('/api/gate/config'), api.get<PolicyDocument>('/api/policy')])
      .then(([r, c, p]) => {
        if (!live) return;
        setReport(r);
        setConfig(c);
        setPolicy(p);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const endSession = async () => {
    await api.post('/api/session/end').catch(() => undefined);
    window.location.assign('/');
  };

  return (
    <>
      <main id="main" tabIndex={-1} className="access">
        <header className="wrap program-hero enter">
          <p className="eyebrow">Live access evaluation · your visit only</p>
          <h1 className="display">
            What this site learned about <em className="mark">your</em> visit.
          </h1>
          <p className="lede">{report ? summarise(report.signals) : failed ? 'Your report could not be loaded.' : 'Loading your report…'}</p>
          <p className="synthetic">
            <b>Real data.</b> Unlike the case study, everything on this page was collected about this connection by the gateway you came through. Only
            you can see it.
          </p>
        </header>

        {failed && (
          <div className="wrap">
            <p className="card" role="alert">
              The report is not available. Your session may have ended; reload to be evaluated again.
            </p>
          </div>
        )}

        {report && (
          <div className="wrap program-body">
            <DecisionBanner report={report} />

            <section className="card">
              <p className="eyebrow">Evidence</p>
              <SignalGroups signals={report.signals} />
            </section>

            <section className="card">
              <p className="eyebrow">Browser fingerprint and recognition · opt-in</p>
              <FingerprintPanel existing={report.fingerprint} config={config} />
            </section>

            <section className="card two-up">
              <div>
                <p className="eyebrow">Why this decision</p>
                <Reasons report={report} />
              </div>
              <div>
                <p className="eyebrow">Server stages, as measured</p>
                <Stages report={report} />
              </div>
            </section>

            <section className="card two-up">
              <div>
                <p className="eyebrow">Every rule in policy {report.policyVersion}</p>
                <Rules report={report} />
              </div>
              <div>
                <p className="eyebrow">Providers called for this evaluation</p>
                <Providers report={report} />
                <p className="eyebrow" style={{ margin: '24px 0 10px' }}>
                  Limits of this evaluation
                </p>
                <ul className="limits">
                  {report.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            {policy && (
              <section className="card">
                <p className="eyebrow">The policy, in full</p>
                <h2 className="h3">{policy.summary}</h2>
                <div className="two-up" style={{ marginTop: 18 }}>
                  <div>
                    <h3 className="h3">Never held against a visitor</h3>
                    <ul className="limits">
                      {policy.notPenalised.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="h3">When something fails</h3>
                    <ul className="limits">
                      {policy.failurePolicy.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="table-scroll" style={{ marginTop: 18 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">Rule</th>
                        <th scope="col">Effect</th>
                        <th scope="col">Condition</th>
                        <th scope="col">Why it exists</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policy.rules.map((rule) => (
                        <tr key={rule.code}>
                          <th scope="row" className="mono">
                            {rule.code}
                          </th>
                          <td>
                            <span className={`chip ${rule.effect === 'DENY' ? 'chip-bad' : 'chip-warn'}`}>{rule.effect}</span>
                          </td>
                          <td>{rule.description}</td>
                          <td>{rule.rationale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card">
              <p className="eyebrow">How the gate works</p>
              <ol className="pipeline">
                {FLOW.map(([title, body]) => (
                  <li key={title}>
                    <b>{title}</b>
                    <span>{body}</span>
                  </li>
                ))}
              </ol>
              <p className="eng-source">
                Policy engine in <code>packages/policy</code>, gateway in <code>apps/api</code>, with an architecture note and threat model in <code>docs/</code>.{' '}
                <Ext className="text-link" href="https://github.com/blueskynoise/portfolio-dashboard">
                  Source on GitHub ↗
                </Ext>
              </p>
            </section>

            <details className="card disclosure">
              <summary>What was not collected, and what it would take</summary>
              <Beyond />
            </details>
            <details className="card disclosure">
              <summary>Privacy: what is collected, why, and for how long</summary>
              <PrivacyNotice config={config} />
            </details>

            <p className="gate-foot">
              Assessment <span className="mono">{report.id}</span> · request <span className="mono">{report.requestId}</span> · session valid until{' '}
              {report.session ? new Date(report.session.expiresAt).toLocaleTimeString() : 'unknown'} ·{' '}
              <button type="button" className="link-btn" onClick={() => void endSession()}>
                End my session
              </button>
            </p>
          </div>
        )}
      </main>
      <Contact />
    </>
  );
}
