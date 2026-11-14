import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentResponse, GateConfig } from '@portfolio/contracts';
import { api, ApiError } from '../lib/api';
import { Beyond } from '../report/Beyond';
import { DecisionBanner, Reasons, Stages } from '../report/Decision';
import { FingerprintPanel } from '../report/Fingerprint';
import { PrivacyNotice } from '../report/Privacy';
import { SignalGroups, summarize } from '../report/Signals';
import { baseline } from './collect';
import { obtainToken } from './turnstile';

/**
 * The entrance.
 *
 * Who this is and what is behind the gate are on screen from the first
 * frame, so nobody has to wait for the evaluation to find out where they
 * are. When the evaluation finishes, the sentence about the visitor and
 * the decision take over, with the way in directly beneath them.
 *
 * Every line of status is a real state of a real process. Nothing is
 * delayed for effect, and the server timings shown are the ones it measured.
 */

type StepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';
interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

type Phase = { name: 'working' } | { name: 'result'; response: AssessmentResponse } | { name: 'unavailable'; detail: string };

const INITIAL_STEPS: Step[] = [
  { label: 'Reading browser capabilities', state: 'pending' },
  { label: 'Verifying this is a browser', state: 'pending' },
  { label: 'Evaluating connection', state: 'pending' },
];

/** What is behind the gate. Static copy: the gate bundle carries none of the portfolio's own content. */
const INSIDE = [
  { title: 'Your evaluation, in full', body: 'Every signal, where it came from, and the policy rule by rule.' },
  { title: 'A security program, investigated', body: 'An interactive case study: a vulnerability backlog that grew, and what the data says about why.' },
  { title: 'Experience and projects', body: 'From GRC leadership to security automation engineering, and four things built outside work.' },
];

export function Gate() {
  const [config, setConfig] = useState<GateConfig | null>(null);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [phase, setPhase] = useState<Phase>({ name: 'working' });
  const widget = useRef<HTMLDivElement>(null);
  const enter = useRef<HTMLAnchorElement>(null);
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
      setPhase({ name: 'result', response });
    } catch (error) {
      setStep(2, { state: 'failed' });
      const detail =
        error instanceof ApiError && error.status === 429
          ? 'Too many requests from this address just now. Wait a minute and try again.'
          : error instanceof ApiError && error.status === 503
            ? 'The evaluation could not be recorded, so no decision was issued. This is a fault on our side, not a judgment about you.'
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

  // Once admitted, the way in takes keyboard focus: Enter continues straight to the portfolio.
  useEffect(() => {
    if (admitted) enter.current?.focus({ preventScroll: true });
  }, [admitted]);

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
        {!report ? (
          <section className="gate-intro enter">
            <p className="eyebrow">Mark Graziano · security engineering, data, automation</p>
            <h1 className="display">I build the systems that turn security data into decisions.</h1>
            <p className="lede">
              This portfolio sits behind a working access gateway that I built. It is evaluating your connection now, and in a moment it will show you
              everything it found.
            </p>
          </section>
        ) : (
          <section className="gate-intro enter">
            <p className="eyebrow">Mark Graziano’s portfolio · your visit, as a server sees it</p>
            <h1 className="display">
              You haven’t introduced yourself. <em className="mark">But your browser already has.</em>
            </h1>
            <p className="lede gate-sentence">{summarize(report.signals)}</p>
            <p className="gate-sub">Nobody asked you for any of that. It arrived with the request, or was looked up from it, in {report.totalMs} ms.</p>
          </section>
        )}

        {report && (
          <DecisionBanner report={report}>
            {admitted && (
              <>
                <a ref={enter} className="btn btn-primary btn-lg" href="/">
                  Enter the portfolio <span className="arrow" aria-hidden="true">→</span>
                </a>
                <a className="btn btn-ghost" href="#evidence">
                  Or see the evidence first
                </a>
              </>
            )}
            {report.decision === 'CHALLENGE' && (
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void evaluate(true)}>
                Run the check
              </button>
            )}
            {report.decision === 'DENY' && (
              <a className="btn btn-ghost" href="mailto:hello@markgraziano.com">
                Think this is wrong? Email me
              </a>
            )}
          </DecisionBanner>
        )}
        {report?.decision === 'CHALLENGE' && <p className="gate-note">The check runs again in the background. It usually resolves without you doing anything.</p>}
        {report?.decision === 'DENY' && <p className="gate-note">Quote request {report.requestId.slice(0, 8)}. The limit lifts by itself in about ten minutes.</p>}

        {/* While working, the steps are the main event. Afterwards they fold away behind the decision. */}
        {report ? (
          <details className="gate-steps-done">
            <summary>
              {steps.filter((s) => s.state === 'done').length} of {steps.length} checks completed · {report.totalMs} ms on the server
            </summary>
            <StepList steps={steps} />
          </details>
        ) : (
          <section className="gate-progress" aria-live="polite" aria-label="Evaluation progress">
            <StepList steps={steps} />
          </section>
        )}
        {/* Turnstile mounts here. In invisible mode it shows nothing; in managed mode it appears only if Cloudflare needs the visitor to act. */}
        <div ref={widget} className="turnstile-slot" />

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

        <section className="inside" aria-labelledby="inside-title">
          <h2 className="eyebrow" id="inside-title">
            {admitted ? 'What you are about to see' : 'Behind the gate'}
          </h2>
          <ol>
            {INSIDE.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b>
                <span>{item.body}</span>
              </li>
            ))}
          </ol>
        </section>

        {report && (
          <>
            <section className="card" id="evidence" tabIndex={-1}>
              <p className="eyebrow">What you sent, without being asked</p>
              <SignalGroups signals={report.signals} only={['connection', 'enrichment']} />
            </section>

            {admitted && (
              <section className="card">
                <p className="eyebrow">Going further</p>
                <FingerprintPanel config={config} />
              </section>
            )}

            <details className="card disclosure">
              <summary>The rest of the evidence: what the page script reported, what was worked out, and what cannot be known</summary>
              <SignalGroups signals={report.signals} only={['script', 'derived', 'none']} />
            </details>

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

        <details className="card disclosure">
          <summary>Privacy: what is collected, why, and for how long</summary>
          <PrivacyNotice config={config} />
        </details>

        <p className="gate-foot">
          This is a public portfolio. Nothing confidential sits behind this gate; it exists to show how such a system is built, and it is enforced by the
          server all the same. Assessment <span className="mono">{report?.id ?? 'pending'}</span>
        </p>
        {config?.botVerification.configured && (
          <p className="gate-foot">
            Bot verification runs invisibly using Cloudflare Turnstile. See{' '}
            <a className="text-link" href="https://www.cloudflare.com/turnstile-privacy-policy/" target="_blank" rel="noopener noreferrer">
              Cloudflare’s Turnstile Privacy Addendum
            </a>
            .
          </p>
        )}
      </main>
    </div>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
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
  );
}
