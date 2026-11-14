import { STAGES } from '../../content/avalanche';
import { Ext } from '../../lib/router';
import { STAGE_ORDER } from '../../sim';

const SOURCES = [
  { name: 'harbor', style: 'Full scans, pulled a page at a time', catch: 'Silence is its only way of saying “fixed”.' },
  { name: 'lantern', style: 'Change feed, read from a saved cursor', catch: 'Explicit revisions. Occasionally forgets to mention one.' },
  { name: 'sieve', style: 'Events pushed at us', catch: 'At least once, in whatever order.' },
];

const STORES: Record<string, string> = {
  ingest: 'cursor',
  dedupe: 'seen keys',
  identity: 'finding store',
  reconcile: 'scan coverage',
  risk: 'asset inventory · exploit intel',
};

const NOTES = [
  ['The pipeline is a pure function.', 'Same seed and switches, same result. This page only replays what it returned; no number on screen is animated into existence.'],
  ['Order comes from the source, not the network.', 'Every update carries the scanner’s own version. Arrival order is treated as noise.'],
  ['Absence is evidence only when the scan was good.', 'Complete, reached the asset, and twice in a row. Otherwise the state is held and the reason is written down.'],
  ['Every stage can be run again.', 'Idempotency keys and versioned updates mean recovery is “resume from the cursor”, not a special code path.'],
  ['Faults change the delivery, never the truth.', 'Which is why the work list at the end is the same whether the run was clean or everything was on fire.'],
] as const;

export function Architecture() {
  return (
    <section className="card arch" aria-labelledby="arch-title">
      <p className="eyebrow">Architecture</p>
      <h2 className="h3" id="arch-title">
        How it fits together
      </h2>

      <div className="arch-diagram" role="img" aria-label="Three sources feed a seven-stage pipeline: ingest, normalize, deduplicate, identity and state, reconcile, risk context, prioritize. The output is a ranked work list.">
        <ul className="arch-sources">
          {SOURCES.map((s) => (
            <li key={s.name}>
              <b className="mono">{s.name}</b>
              <span>{s.style}</span>
              <em>{s.catch}</em>
            </li>
          ))}
        </ul>
        <div className="arch-arrow" aria-hidden="true">
          ↓
        </div>
        <ol className="arch-stages">
          {STAGE_ORDER.map((id) => (
            <li key={id}>
              <b>{STAGES[id].name}</b>
              {STORES[id] && <span>{STORES[id]}</span>}
            </li>
          ))}
        </ol>
        <div className="arch-arrow" aria-hidden="true">
          ↓
        </div>
        <p className="arch-out">A short, ranked list of work</p>
      </div>

      <ol className="arch-notes">
        {NOTES.map(([title, body]) => (
          <li key={title}>
            <b>{title}</b> {body}
          </li>
        ))}
      </ol>

      <div className="arch-caveat">
        <p>
          <b>What this is not.</b> There are no real scanners, vendors, vulnerabilities or organisations here: the three
          sources are fictional, identifiers are prefixed <span className="mono">SYN-</span>, and the whole thing runs in
          your browser tab. It protects nothing. And “two good scans” is a policy, not a proof. Something can be missing
          twice and still exist; a real deployment would tune that per source.
        </p>
        <p>
          The engine lives in <span className="mono">src/sim</span>, separate from this interface, with tests that run
          all 64 combinations of the switches above.{' '}
          <Ext className="text-link" href="https://github.com/blueskynoise/portfolio-dashboard">
            Source on GitHub ↗
          </Ext>
        </p>
      </div>
    </section>
  );
}
