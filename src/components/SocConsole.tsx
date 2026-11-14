import { useEffect, useRef, useState } from 'react';
import { formatNumber, useReducedMotion } from '../lib/hooks';
import { Link } from '../lib/router';

/**
 * The World's Most Reasonable SOC.
 *
 * A scripted joke, not a sensor. Nothing here reads anything about the
 * visitor or their browser: the events are a fixed list, and the first
 * one plays for everybody.
 */

interface SocEvent {
  event: string;
  severity: string;
  analysis: string;
  risk: string;
  action: string;
  resolution: string;
}

const EVENTS: SocEvent[] = [
  {
    event: 'Website visitor detected',
    severity: 'Informational',
    analysis: 'Someone accessed a publicly available website.',
    risk: 'None identified.',
    action: 'Absolutely nothing.',
    resolution: 'Working as intended.',
  },
  {
    event: 'Visitor is reading the page',
    severity: 'Informational',
    analysis: 'The website contains words. They appear to be for reading.',
    risk: 'Mild interest.',
    action: 'Do not interrupt.',
    resolution: 'Working as intended.',
  },
  {
    event: 'Link clicked',
    severity: 'Informational',
    analysis: 'A link was followed by someone who wanted to go where it goes.',
    risk: 'None identified.',
    action: 'Let them.',
    resolution: 'Working as intended.',
  },
  {
    event: 'Tab left open over lunch',
    severity: 'Informational',
    analysis: 'The visitor may be eating.',
    risk: 'Crumbs. Out of scope.',
    action: 'Absolutely nothing.',
    resolution: 'Working as intended.',
  },
];

const ESCALATION: SocEvent = {
  event: 'Manual escalation requested',
  severity: 'Informational (still)',
  analysis: 'A human asked the system to be more worried than the evidence supports.',
  risk: 'Alert fatigue.',
  action: 'Decline, politely.',
  resolution: 'Escalation closed. Nobody was paged.',
};

const FIELDS: readonly (readonly [keyof SocEvent, string])[] = [
  ['event', 'Event'],
  ['severity', 'Severity'],
  ['analysis', 'Analysis'],
  ['risk', 'Risk'],
  ['action', 'Recommended action'],
  ['resolution', 'Resolution'],
];

const STEP_MS = 520;

export function SocConsole() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [escalated, setEscalated] = useState(false);
  const [shown, setShown] = useState(reduced ? FIELDS.length : 0);
  const [handled, setHandled] = useState(reduced ? 1 : 0);
  const counted = useRef(reduced);

  const current = escalated ? ESCALATION : (EVENTS[index % EVENTS.length] as SocEvent);
  const done = shown >= FIELDS.length;

  useEffect(() => {
    if (done) {
      if (!counted.current) {
        counted.current = true;
        setHandled((n) => n + 1);
      }
      return;
    }
    const timer = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 700 : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [shown, done]);

  const play = (next: { index?: number; escalated: boolean }) => {
    counted.current = false;
    setEscalated(next.escalated);
    if (next.index !== undefined) setIndex(next.index);
    setShown(reduced ? FIELDS.length : 0);
  };

  return (
    <div>
      <section className="soc" aria-labelledby="soc-title">
        <div className="soc-head">
          <h2 className="soc-title" id="soc-title">
            <span className="soc-dot" aria-hidden="true" />
            The World’s Most Reasonable SOC
          </h2>
          <span className="chip">Simulated</span>
        </div>

        <dl className="soc-body" aria-live="polite">
          {FIELDS.slice(0, shown).map(([key, label], i) => (
            <div className={`soc-row${key === 'resolution' ? ' is-final' : ''}`} key={`${index}-${escalated}-${i}`}>
              <dt>{label}</dt>
              <dd>
                {key === 'severity' ? (
                  <span className="chip chip-info">{current[key]}</span>
                ) : key === 'resolution' ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <circle cx="9" cy="9" r="9" fill="currentColor" />
                      <path d="M5 9.4l2.6 2.6L13 6.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {current[key]}
                  </>
                ) : (
                  current[key]
                )}
              </dd>
            </div>
          ))}
          {!done && (
            <div className="soc-thinking" aria-hidden="true">
              <i />
              <i />
              <i />
              {shown === 0 ? 'Triaging' : 'Thinking very carefully'}
            </div>
          )}
        </dl>

        <div className="soc-stats" aria-label="SOC statistics">
          <div>
            <b>{formatNumber(handled)}</b>
            <span>events triaged</span>
          </div>
          <div>
            <b>0</b>
            <span>incidents declared</span>
          </div>
          <div>
            <b>0</b>
            <span>people paged</span>
          </div>
        </div>

        <div className="soc-foot">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!done} onClick={() => play({ index: index + 1, escalated: false })}>
            Next event
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!done || escalated} onClick={() => play({ escalated: true })}>
            Escalate anyway
          </button>
          <span className="spacer" />
          <Link to="/avalanche" className="btn btn-primary btn-sm">
            Now try 10,000 <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <p className="soc-note">
        These events are scripted and identical for everyone. This site does not inspect your browser, set cookies or
        run analytics.
      </p>
    </div>
  );
}
