import { useEffect, useState } from 'react';
import type { AssessmentReport } from '@portfolio/contracts';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import { summarize } from '../report/Signals';

/**
 * The visitor's own evaluation, in brief.
 *
 * Real data: this is the decision the gateway made about this visit a
 * moment ago. If it cannot be loaded, the card says what the gate does
 * instead of showing a made-up example.
 */
const TITLE = { ALLOW: 'Access granted', CHALLENGE: 'Challenge required', DENY: 'Access refused' } as const;

export function EvaluationCard() {
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<AssessmentReport>('/api/me/assessment')
      .then((r) => live && setReport(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const established = report?.signals.filter((s) => s.kind !== 'gap').length ?? 0;
  const matched = report?.rules.filter((r) => r.outcome === 'matched').length ?? 0;

  return (
    <aside className="eval-card" aria-labelledby="eval-card-title" aria-busy={!report && !failed}>
      <header>
        <h2 id="eval-card-title">This site just evaluated you</h2>
        <span className="chip chip-good">Live · your visit</span>
      </header>
      {report ? (
        <>
          <p className="eval-decision">
            {TITLE[report.decision]}
            <span>{report.assurance} assurance</span>
          </p>
          <p className="eval-sentence">{summarize(report.signals)}</p>
          <dl>
            <div>
              <dt>Signals established</dt>
              <dd>
                {established} of {report.signals.length}
              </dd>
            </div>
            <div>
              <dt>Policy rules matched</dt>
              <dd>
                {matched} of {report.rules.length}
              </dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd className="mono">{report.policyVersion}</dd>
            </div>
            <div>
              <dt>Decided in</dt>
              <dd>{report.totalMs} ms</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="eval-sentence">
          {failed
            ? 'Every visit passes through an access gateway before this page is served: the connection is looked up, a versioned policy decides, and the decision is recorded.'
            : 'Loading the decision the gateway made about this visit…'}
        </p>
      )}
      <Link to="/access" className="eval-link">
        See everything it learned, and why it decided <span className="arrow" aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}
