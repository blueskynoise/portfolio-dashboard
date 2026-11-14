import { useState } from 'react';
import type { CollectionMethod, Reliability, Signal, SignalKind } from '@portfolio/contracts';

/** How a visitor reads their own evidence: grouped by how it was obtained, each item expandable to its provenance. */

const GROUPS: { method: CollectionMethod; title: string; blurb: string }[] = [
  { method: 'connection', title: 'Arrived with your connection', blurb: 'Sent before any script ran. There is no way to load a web page without handing these over.' },
  { method: 'enrichment', title: 'Looked up from your address', blurb: 'We asked third parties what they know about the address you connected from. You were not involved.' },
  { method: 'script', title: 'Read by a script in this page', blurb: 'Reported by your own browser when asked. Easy for a script to read, and easy for a browser to lie about.' },
  { method: 'derived', title: 'Worked out from the above', blurb: 'Conclusions we drew by combining and comparing the rest.' },
  { method: 'none', title: 'What this cannot know', blurb: 'Stated plainly, because a missing answer is not a clean one.' },
];

const KIND_LABEL: Record<SignalKind, string> = { fact: 'Observed', claim: 'Self-reported', classification: 'Classification', inference: 'Inference', gap: 'Unknown' };
const KIND_CLASS: Record<SignalKind, string> = { fact: 'chip-good', claim: 'chip-info', classification: 'chip-warn', inference: 'chip-warn', gap: '' };
const RELIABILITY_LEVEL: Record<Reliability, number> = { high: 3, medium: 2, low: 1, none: 0 };

export function formatValue(signal: Signal): string {
  if (signal.value === null) return signal.status === 'not_measurable' ? 'Cannot be measured' : signal.status === 'unconfigured' ? 'Not configured' : 'Unknown';
  if (typeof signal.value === 'boolean') return signal.value ? 'Yes' : 'No';
  return String(signal.value);
}

const age = (seconds: number): string => (seconds < 90 ? `${seconds}s old` : seconds < 5400 ? `${Math.round(seconds / 60)} min old` : `${Math.round(seconds / 3600)} h old`);

function Reliable({ level }: { level: Reliability }) {
  return (
    <span className="rel" title={`Reliability: ${level}`}>
      <span className="sr-only">Reliability: {level}</span>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= RELIABILITY_LEVEL[level] ? 'on' : ''} aria-hidden="true" />
      ))}
    </span>
  );
}

function Row({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false);
  const id = `sig-${signal.key.replace(/\W/g, '-')}`;
  return (
    <li className={`sig${signal.kind === 'gap' ? ' is-gap' : ''}`}>
      <button type="button" className="sig-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="sig-label">{signal.label}</span>
        <span className="sig-value">{formatValue(signal)}</span>
        <span className="sig-meta">
          <span className={`chip ${KIND_CLASS[signal.kind]}`}>{KIND_LABEL[signal.kind]}</span>
          <Reliable level={signal.reliability} />
          <span className="sig-caret" aria-hidden="true">
            {open ? '−' : '+'}
          </span>
        </span>
      </button>
      {open && (
        <dl className="sig-detail" id={id}>
          {signal.how && (
            <div>
              <dt>How we got it</dt>
              <dd>{signal.how}</dd>
            </div>
          )}
          <div>
            <dt>Source</dt>
            <dd>
              {signal.source}
              {signal.ageSeconds !== undefined && signal.ageSeconds > 0 ? ` · answer was ${age(signal.ageSeconds)}` : ''}
            </dd>
          </div>
          {signal.note && (
            <div>
              <dt>Limitation</dt>
              <dd>{signal.note}</dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

/**
 * `collapsible` renders each group closed, with a one-line count of what was established and what was not,
 * so a page can lead with the conclusion and leave the evidence one click away.
 */
export function SignalGroups({ signals, only, collapsible = false }: { signals: Signal[]; only?: CollectionMethod[]; collapsible?: boolean }) {
  return (
    <div className="sig-groups">
      {GROUPS.filter((g) => !only || only.includes(g.method)).map((group) => {
        const items = signals.filter((s) => s.method === group.method);
        if (items.length === 0) return null;
        if (collapsible) {
          const known = items.filter((s) => s.kind !== 'gap').length;
          return (
            <details key={group.method} className="sig-group sig-fold">
              <summary>
                <span className="sig-fold-title">{group.title}</span>
                <span className="sig-fold-count">
                  {group.method === 'none' ? `${items.length} stated limits` : `${known} established${items.length - known > 0 ? `, ${items.length - known} unknown` : ''}`}
                </span>
              </summary>
              <p className="sig-fold-blurb">{group.blurb}</p>
              <ul>
                {items.map((s) => (
                  <Row key={s.key} signal={s} />
                ))}
              </ul>
            </details>
          );
        }
        return (
          <section key={group.method} className="sig-group">
            <header>
              <h3>{group.title}</h3>
              <p>{group.blurb}</p>
            </header>
            <ul>
              {items.map((s) => (
                <Row key={s.key} signal={s} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function SignalList({ signals }: { signals: Signal[] }) {
  return (
    <ul className="sig-flat">
      {signals.map((s) => (
        <Row key={s.key} signal={s} />
      ))}
    </ul>
  );
}

/** One sentence built only from what was actually established. */
export function summarize(signals: Signal[]): string {
  const value = (key: string): string | null => {
    const s = signals.find((x) => x.key === key);
    return s && s.value !== null && s.kind !== 'gap' ? String(s.value) : null;
  };
  const location = value('network.location');
  const operator = value('network.asn')?.split(' · ')[1] ?? null;
  const browser = value('browser.identity');
  const language = value('browser.languages')?.split(',')[0] ?? null;
  const parts = [
    location || operator ? `You are connecting ${location ? `from around ${location}` : ''}${operator ? `${location ? ', ' : ''}through ${operator}` : ''}` : null,
    browser ? `${location || operator ? 'using' : 'You are using'} ${browser}` : null,
    language ? `with ${language} as your first language` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(', ')}.` : 'Very little could be established about this connection, which is itself worth knowing.';
}
