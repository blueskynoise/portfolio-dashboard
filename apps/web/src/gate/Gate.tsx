import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentResponse, GateConfig } from '@portfolio/contracts';
import { api, ApiError } from '../lib/api';
import { Beyond } from '../report/Beyond';
import { DecisionBanner, Reasons, Stages } from '../report/Decision';
import { FingerprintPanel } from '../report/Fingerprint';
import { PrivacyNotice } from '../report/Privacy';
import { SignalGroups, summarise } from '../report/Signals';
import { baseline } from './collect';
import { obtainToken } from './turnstile';

/**
 * The entrance.
 *
 * Every line of status on this screen is a real state of a real process:
 * reading the browser, waiting on the verification widget, waiting on our
 * server. Nothing is delayed for effect, and the timings shown for the
 * server's stages are the ones it measured.
 */

type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';
interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

type Phase =
  | { name: 'working' }
  | { name: 'result'; response: AssessmentResponse }
  | { name: 'unavailable'; detail: string };

const INITIAL_STEPS: Step[] = [
  { label: 'Reading browser capabilities', state: 'pending' },
  { label: 'Verifying this is a browser', state: 'pending' },
  { label: 'Evaluating connection', state: 'pending' },
];

export function Gate() {
  const [config, setConfig] = useState<GateConfig | null>(null);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [phase, setPhase] = useState<Phase>({ name: 'working' });
  const [challenging, setChallenging] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const setStep = (index: number, patch: Partial<Step>): void => setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  const evaluate = useCallback(async (visibleChallenge: boolean) => {
    setPhase({ name: 'working' });
    setSteps(INITIAL_STEPS);
    let gateConfig: GateConfig;
    try {
      gateConfig = await api.get<GateConfig>('/api/gate/config');
      setConfig(gateConfig);
    } catch {
      setPhase({ name: 'unavailable', detail: 'The evaluation service did not answer.' });
      return;
    }

    setStep(0, { state: 'active' });
    const t0 = performance.now();
    const client = baseline();
    setStep(0, { state: 'done', detail: `${Math.max(1, Math.round(performance.now() - t0))} ms, in your browser` });

    let botToken: string | undefined;
    if (!gateConfig.botVerification.configured || !gateConfig.botVerification.siteKey) {
      setStep(1, { state: 'skipped', detail: 'Not configured on this deployment. Recorded as not assessed, not as passed.' });
    } else if (widget.current) {
      setStep(1, { state: 'active', detail: 'Waiting for Cloudflare Turnstile' });
      const result = await obtainToken(widget.current, gateConfig.botVerification.siteKey, visibleChallenge);
      botToken = result.token;
      setStep(1, result.token ? { state: 'done', detail: 'Token issued; our server will check it' } : { state: 'failed', detail: `${result.problem}. Continuing without it.` });
    }

    setStep(2, { state: 'active', detail: 'Network lookup, verification and policy, on the server' });
    try {
      const response = await api.post<AssessmentResponse>('/api/assessments', { client, botToken });
      setStep(2, { state: 'done', detail: `${response.report.totalMs} ms on the server` });
      setChallenging(response.report.decision === 'CHALLENGE');
      setPhase({ name: 'result', response });
    } catch (error) {
      setStep(2, { state: 'failed' });
      const detail =
        error instanceof ApiError && error.status === 429
          ? 'Too many requests from this address just now. Wait a minute and try again.'
          : error instanceof ApiError && error.status === 503
            ? 'The evaluation could not be recorded, so no decision was issued. This is a fault on our side, not a judgement about you.'
            : 'The evaluation service could not be reached.';
      setPhase({ name: 'unavailable', detail });
    }
  }, []);

  useEffect(() => {
    // Guard against the double invocation React performs in development.
    if (started.current) return;
    started.current = true;
    void evaluate(false);
  }, [evaluate]);

  const report = phase.name === 'result' ? phase.response.report : null;
  const admitted = phase.name === 'result' && phase.response.admitted;

  return (
    <div className="gate">
      <header className="gate-top wrap">
        <span className="nav-name">
          <span className="nav-mark" aria-hidden="true">
            MG
          </span>
          <span>Mark Graziano</span>
        </span>
        <span className="chip">Live access evaluation</span>
      </header>

      <main className="wrap gate-main" id="main">
        {phase.name !== 'result' && (
          <section className="gate-intro enter">
            <p className="eyebrow">Before the portfolio</p>
            <h1 className="display">Checking who’s at the door.</h1>
            <p className="lede">
              This site is fronted by a working access gateway. It is looking at your connection now, and in a moment it will show you
              everything it found.
            </p>
          </section>
        )}

        {report && (
          <section className="gate-intro enter">
            <p className="eyebrow">Your visit, as a server sees it</p>
            <h1 className="display">
              You haven’t introduced yourself. <em className="mark">But your browser already has.</em>
            </h1>
            <p className="lede">{summarise(report.signals)}</p>
            <p className="gate-sub">
              Nobody asked you for any of that. It arrived with the request, or was looked up from it, in {report.totalMs} ms. Open any line below to see where it came from and how far it can be trusted.
            </p>
          </section>
        )}

        <section className="gate-progress" aria-live="polite" aria-label="Evaluation progress">
          <ol className="steps">
            {steps.map((step) => (
              <li key={step.label} className={`step-${step.state}`}>
                <span className="step-mark" aria-hidden="true" />
                <span>
                  <b>{step.label}</b>
                  {step.detail && <span className="step-detail">{step.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {/* Turnstile renders here. It stays empty unless Cloudflare needs the visitor to do something. */}
          <div ref={widget} className="turnstile-slot" />
        </section>

        {phase.name === 'unavailable' && (
          <section className="card gate-problem" role="alert">
            <h2 className="h3">The evaluation could not be completed.</h2>
            <p>{phase.detail}</p>
            <p>No access decision was made and nothing about this attempt was treated as a pass or a fail.</p>
            <div className="hero-cta">
              <button type="button" className="btn btn-primary" onClick={() => void evaluate(false)}>
                Try again
              </button>
              <a className="btn btn-ghost" href="mailto:hello@markgraziano.com">
                Email me instead
              </a>
            </div>
          </section>
        )}

        {report && (
          <>
            <DecisionBanner report={report} />

            {admitted && (
              <div className="gate-enter">
                <a className="btn btn-primary btn-lg" href="/">
                  Enter the portfolio <span className="arrow" aria-hidden="true">→</span>
                </a>
                <span>The server has issued a session. The portfolio is not delivered to any request without one.</span>
              </div>
            )}
            {challenging && (
              <div className="gate-enter">
                <button type="button" className="btn btn-primary btn-lg" onClick={() => void evaluate(true)}>
                  Run the check
                </button>
                <span>Cloudflare Turnstile will appear above. It usually resolves without a puzzle.</span>
              </div>
            )}
            {report.decision === 'DENY' && (
              <div className="gate-enter">
                <a className="btn btn-ghost" href="mailto:hello@markgraziano.com">
                  Think this is wrong? Email me
                </a>
                <span>Quote request {report.requestId.slice(0, 8)}. The limit lifts by itself in about ten minutes.</span>
              </div>
            )}

            <section className="card">
              <p className="eyebrow">What you sent, without being asked</p>
              <SignalGroups signals={report.signals} only={['connection', 'enrichment']} />
            </section>

            {admitted && (
              <section className="card">
                <p className="eyebrow">Going further</p>
                <FingerprintPanel config={config} />
              </section>
            )}

            <section className="card">
              <p className="eyebrow">The rest of the evidence</p>
              <SignalGroups signals={report.signals} only={['script', 'derived', 'none']} />
            </section>

            <section className="card two-up">
              <div>
                <p className="eyebrow">Why this decision</p>
                <Reasons report={report} />
              </div>
              <div>
                <p className="eyebrow">What the server did, and how long each part took</p>
                <Stages report={report} />
              </div>
            </section>

            <details className="card disclosure">
              <summary>What this page did not collect, and what it would take</summary>
              <Beyond />
            </details>
          </>
        )}

        <details className="card disclosure" open={phase.name === 'working' ? undefined : false}>
          <summary>Privacy: what is collected, why, and for how long</summary>
          <PrivacyNotice config={config} />
        </details>

        <p className="gate-foot">
          This is a public portfolio. Nothing confidential sits behind this gate; it exists to show how such a system is built, and it is
          enforced by the server all the same. Assessment <span className="mono">{report?.id ?? 'pending'}</span>
        </p>
      </main>
    </div>
  );
}
