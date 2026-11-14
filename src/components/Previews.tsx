import { useState } from 'react';
import type { ProjectSlug } from '../content/projects';

/**
 * Small interactive sketches of each product's central idea.
 *
 * These are illustrations written for this portfolio. They are not
 * screenshots or reproductions of the real interfaces, and every value
 * in them is made up.
 */

const STORY = [
  'Once there was a small bear who could not sleep.',
  'So the bear called the moon. The moon picked up on the first ring.',
  '“Read to me,” said the bear. And the moon did.',
  'The end. (Again?)',
];

function BivviPreview() {
  const [page, setPage] = useState(0);
  const last = page === STORY.length - 1;
  return (
    <div className="pv-bivvi">
      <div className="pv-readers" aria-hidden="true">
        <span>
          <i style={{ background: '#e8b04a' }} /> Grandparent
        </span>
        <span>
          <i style={{ background: '#7fb38a' }} /> Grandchild
        </span>
        <em>both on page {page + 1}</em>
      </div>
      <div className="pv-book" aria-live="polite">
        <p key={page}>{STORY[page]}</p>
        <span className="pv-pageno">
          {page + 1} / {STORY.length}
        </span>
      </div>
      <button type="button" className="pv-arrow" onClick={() => setPage(last ? 0 : page + 1)} aria-label={last ? 'Read it again' : 'Turn the page'}>
        {last ? '↺' : '→'}
      </button>
      <p className="pv-caption">That arrow is the whole interface a grandparent needs.</p>
    </div>
  );
}

const RADIO_ROWS = [
  ['001', 'SAMPLE-A', '146.940', '−0.600', '−', 'Tone', '100.0', 'High', '25k'],
  ['002', 'SAMPLE-B', '442.100', '+5.000', '+', 'TSQL', '123.0', 'High', '25k'],
  ['003', 'SAMPLE-C', '147.300', '+0.600', '+', 'Tone', '88.5', 'Low', '12.5k'],
  ['004', 'SAMPLE-D', '146.520', '0.000', 'off', 'None', '—', 'Low', '25k'],
];
const PLACES = ['Around home', 'On a road trip', 'At an event'];

function TxrPreview() {
  const [mode, setMode] = useState<'usual' | 'guided'>('usual');
  const [place, setPlace] = useState<string | null>(null);
  return (
    <div>
      <div className="seg" role="radiogroup" aria-label="Compare approaches">
        {(['usual', 'guided'] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}>
            {value === 'usual' ? 'The usual way' : 'Start from the place'}
          </button>
        ))}
      </div>
      {mode === 'usual' ? (
        <div className="pv-grid-scroll">
          <table className="pv-grid">
            <caption className="sr-only">A typical radio programming grid, with made-up values</caption>
            <thead>
              <tr>
                {['Ch', 'Name', 'RX Freq', 'Offset', 'Duplex', 'Tone Mode', 'CTCSS', 'Power', 'Width'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RADIO_ROWS.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pv-caption">Nine columns of vocabulary before you’ve said where you’re going.</p>
        </div>
      ) : (
        <div className="pv-guided">
          <p className="pv-q">Where do you want to communicate?</p>
          <div className="pv-choices">
            {PLACES.map((p) => (
              <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(p)}>
                {p}
              </button>
            ))}
          </div>
          <p className="pv-caption" aria-live="polite">
            {place
              ? `“${place}” is a complete answer. Tones, offsets and duplex are the software’s job from here.`
              : 'One question, in words a person would use.'}
          </p>
        </div>
      )}
    </div>
  );
}

const OUTPUTS = [
  {
    id: 'email',
    title: 'Follow-up email',
    body: 'Hi Dana, thanks for today. Attached is the pricing summary for the twelve-seat pilot. I’ll have the security questionnaire back to you by the 14th.',
    verb: 'Send',
    done: 'Sent',
  },
  {
    id: 'crm',
    title: 'CRM update',
    body: 'Stage → Pilot agreed · Seats → 12 · Next step → Questionnaire due the 14th',
    verb: 'Update',
    done: 'Updated',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    body: '☐ Send pricing summary today   ☐ Return security questionnaire by the 14th',
    verb: 'Push to Google Tasks',
    done: 'Pushed',
  },
] as const;

function SummaPreview() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const count = Object.values(done).filter(Boolean).length;
  return (
    <div className="pv-summa">
      <div className="pv-call">
        <p className="eyebrow">One call (made-up example)</p>
        <p>
          <b>Client</b> We’d start with a pilot. Twelve seats.
        </p>
        <p>
          <b>Client</b> And we need the security questionnaire back by the 14th.
        </p>
        <p>
          <b>Rep</b> I’ll send the pricing summary over today.
        </p>
        <p className="pv-caption" aria-live="polite">
          {count} of {OUTPUTS.length} done · things retyped: 0
          {count > 0 && (
            <>
              {' · '}
              <button type="button" className="pv-reset" onClick={() => setDone({})}>
                reset
              </button>
            </>
          )}
        </p>
      </div>
      <ul className="pv-outputs">
        {OUTPUTS.map((o) => (
          <li key={o.id} className={done[o.id] ? 'is-done' : ''}>
            <div>
              <h4>{o.title}</h4>
              <p>{o.body}</p>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" disabled={done[o.id]} onClick={() => setDone({ ...done, [o.id]: true })}>
              {done[o.id] ? `${o.done} ✓` : o.verb}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Preview({ slug }: { slug: ProjectSlug }) {
  if (slug === 'bivvi') return <BivviPreview />;
  if (slug === 'txr-studio') return <TxrPreview />;
  return <SummaPreview />;
}
