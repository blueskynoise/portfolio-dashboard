import type { ReactNode } from 'react';
import type { AssessmentReport } from '@portfolio/contracts';

const TONE = { ALLOW: 'good', CHALLENGE: 'warn', DENY: 'bad' } as const;
const TITLE = { ALLOW: 'Access granted', CHALLENGE: 'One more check', DENY: 'Access refused' } as const;

/** The decision, its assurance, and whatever the visitor can do next. `children` is the action area. */
export function DecisionBanner({ report, children }: { report: AssessmentReport; children?: ReactNode }) {
  return (
    <section className={`verdict-banner verdict-banner-${TONE[report.decision]}`} aria-labelledby="decision-title">
      <div className="decision-main">
        <p className="eyebrow">Policy decision</p>
        <h2 id="decision-title">{TITLE[report.decision]}</h2>
        <p>{report.explanation}</p>
        {children && <div className="decision-actions">{children}</div>}
      </div>
      <dl className="decision-facts">
        <div>
          <dt>Decision</dt>
          <dd className="mono">{report.decision}</dd>
        </div>
        <div>
          <dt>Assurance</dt>
          <dd>{report.assurance}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd className="mono">{report.policyVersion}</dd>
        </div>
        <div>
          <dt>Evaluated in</dt>
          <dd>{report.totalMs} ms</dd>
        </div>
      </dl>
    </section>
  );
}

export function Reasons({ report }: { report: AssessmentReport }) {
  return (
    <ul className="reasons">
      {report.reasons.map((reason) => (
        <li key={reason.code}>
          <span className={`chip ${reason.effect === 'NOTE' ? '' : `chip-${TONE[reason.effect]}`}`}>{reason.effect === 'NOTE' ? 'noted' : reason.effect.toLowerCase()}</span>
          <div>
            <b className="mono">{reason.code}</b>
            <p>{reason.summary}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Stages({ report }: { report: AssessmentReport }) {
  return (
    <ol className="stages">
      {report.stages.map((stage) => (
        <li key={stage.stage} className={`stage-${stage.status}`}>
          <span className="stage-mark" aria-hidden="true" />
          <span className="stage-label">{stage.label}</span>
          <span className="stage-detail">{stage.detail}</span>
          <span className="stage-ms">{stage.ms} ms</span>
        </li>
      ))}
    </ol>
  );
}

export function Rules({ report }: { report: AssessmentReport }) {
  const label = { matched: 'matched', not_matched: 'did not match', not_evaluable: 'could not be evaluated' } as const;
  return (
    <ul className="rules">
      {report.rules.map((rule) => (
        <li key={rule.code} className={`rule-${rule.outcome}`}>
          <div>
            <b className="mono">{rule.code}</b>
            <p>{rule.description}</p>
          </div>
          <span className={`chip ${rule.outcome === 'matched' ? 'chip-warn' : rule.outcome === 'not_evaluable' ? 'chip-info' : ''}`}>{label[rule.outcome]}</span>
        </li>
      ))}
    </ul>
  );
}

export function Providers({ report }: { report: AssessmentReport }) {
  const tone = { ok: 'chip-good', cache: 'chip-good', timeout: 'chip-bad', error: 'chip-bad', unconfigured: '', skipped: '' } as const;
  return (
    <ul className="providers">
      {report.providers.map((p) => (
        <li key={p.provider}>
          <b className="mono">{p.provider}</b>
          <span>{p.purpose}</span>
          <span className={`chip ${tone[p.status]}`}>{p.status === 'cache' ? 'cached' : p.status}</span>
          <span className="muted">{p.status === 'ok' ? `${p.latencyMs} ms` : (p.detail ?? '')}</span>
        </li>
      ))}
    </ul>
  );
}
