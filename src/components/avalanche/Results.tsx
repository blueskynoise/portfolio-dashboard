import { useMemo, useState } from 'react';
import { formatNumber, useCountUp } from '../../lib/hooks';
import {
  CYCLES,
  type AssessedFinding,
  type DecisionCode,
  type FindingStatus,
  type SimulationResult,
} from '../../sim';

// ── Funnel ────────────────────────────────────────────────────────────

export function Funnel({ result }: { result: SimulationResult }) {
  const f = result.funnel;
  const matter = useCountUp(f.actNow, 900);
  const rows: { label: string; note: string; value: number; emphasis?: boolean }[] = [
    { label: 'alerts received', note: 'everything three scanners sent across five scans', value: f.received },
    { label: 'after dropping redeliveries', note: 'the same record delivered again is not news', value: f.afterDedupe },
    { label: 'distinct findings', note: 'one vulnerability on one asset, however often it was reported', value: f.uniqueFindings },
    { label: 'still open', note: 'the rest were fixed, and confirmed fixed', value: f.stillOpen },
    { label: 'matter now', note: 'exploitable, exposed, and on something that counts', value: f.actNow, emphasis: true },
    { label: 'pieces of work', note: 'the upgrades that close them', value: f.actions, emphasis: true },
  ];
  return (
    <section className="card funnel" aria-labelledby="funnel-title">
      <p className="eyebrow">The answer</p>
      <h2 className="h2" id="funnel-title">
        {f.actNow === 0 ? (
          <>None of them, today. Go to lunch.</>
        ) : (
          <>
            <em className="mark">{formatNumber(matter)}</em> matter. That’s {formatNumber(f.actions)} piece{f.actions === 1 ? '' : 's'} of work.
          </>
        )}
      </h2>
      <ol className="funnel-rows">
        {rows.map((row) => {
          const share = f.received > 0 ? row.value / f.received : 0;
          return (
            <li key={row.label} className={row.emphasis ? 'is-emphasis' : ''} title={`${(share * 100).toFixed(share < 0.01 ? 2 : 1)}% of alerts received`}>
              <div className="funnel-label">
                <b>{formatNumber(row.value)}</b> {row.label}
                <span>{row.note}</span>
              </div>
              <div className="funnel-track" aria-hidden="true">
                <i style={{ width: `max(3px, ${share * 100}%)` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Verification ──────────────────────────────────────────────────────

interface VerificationProps {
  result: SimulationResult;
  naive: SimulationResult;
  clean: SimulationResult | null;
}

export function VerificationCard({ result, naive, clean }: VerificationProps) {
  const wrong = result.everWronglyClosed.length;
  const naiveWrong = naive.everWronglyClosed.length;
  const peakHeld = Math.max(...result.cycles.map((c) => c.verification.awaitingConfirmation));
  const totals = result.cycles.reduce(
    (sum, c) => ({
      limited: sum.limited + c.transport.rateLimited,
      failed: sum.failed + c.transport.failedPages,
      waited: sum.waited + c.transport.waitedMs,
    }),
    { limited: 0, failed: 0, waited: 0 },
  );
  const sameAsClean =
    clean === null ||
    JSON.stringify(clean.actions.map((a) => [a.pkg, a.urgent.map((u) => u.finding.key)])) ===
      JSON.stringify(result.actions.map((a) => [a.pkg, a.urgent.map((u) => u.finding.key)]));

  return (
    <section className="card verify" aria-labelledby="verify-title">
      <p className="eyebrow">Marked against ground truth</p>
      <h2 className="h3" id="verify-title">
        The simulation knows what’s really out there, so the pipeline’s homework gets checked after every scan.
      </h2>
      <dl className="verify-grid">
        <div className={wrong === 0 ? 'is-good' : 'is-bad'}>
          <dt>Live findings closed by mistake</dt>
          <dd>{formatNumber(wrong)}</dd>
          <p>The one error that must not happen: telling someone a problem is gone when it isn’t.</p>
        </div>
        <div className={naiveWrong > 0 ? 'is-bad' : ''}>
          <dt>Same data, naive pipeline</dt>
          <dd>{formatNumber(naiveWrong)}</dd>
          <p>
            {naiveWrong > 0
              ? 'Closed by mistake when “missing means fixed”, arrival order wins, and nothing is double-checked.'
              : 'With nothing going wrong, the first-draft version is right too. That’s why it ships. Switch on some conditions.'}
          </p>
        </div>
        <div>
          <dt>Held open until proven fixed</dt>
          <dd>{formatNumber(peakHeld)}</dd>
          <p>At the worst moment, findings that were really gone but not yet confirmed. The price of not guessing.</p>
        </div>
        <div className={sameAsClean ? 'is-good' : 'is-bad'}>
          <dt>Same work list as a clean run</dt>
          <dd>{sameAsClean ? 'Yes' : 'No'}</dd>
          <p>
            {clean === null
              ? 'This is the clean run.'
              : `After ${formatNumber(totals.limited)} rate limits, ${totals.failed} lost page${totals.failed === 1 ? '' : 's'} and ${(totals.waited / 1000).toFixed(0)} seconds of simulated waiting.`}
          </p>
        </div>
      </dl>
    </section>
  );
}

// ── Work list ─────────────────────────────────────────────────────────

const BAND_CHIP = { act: 'chip-bad', schedule: 'chip-warn', backlog: '' } as const;
const BAND_LABEL = { act: 'act now', schedule: 'schedule', backlog: 'backlog' } as const;

export function WorkList({ result, onFollow }: { result: SimulationResult; onFollow: (key: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const actions = showAll ? result.actions : result.actions.slice(0, 5);
  if (result.actions.length === 0) {
    return (
      <section className="card">
        <p className="eyebrow">The work</p>
        <h2 className="h3">Nothing urgent in this dataset.</h2>
        <p className="muted">
          {formatNumber(result.funnel.stillOpen)} findings are open and none of them clears the bar for dropping what
          you’re doing. That is a legitimate answer. Try a bigger dataset.
        </p>
      </section>
    );
  }
  const max = result.actions[0]?.riskRemoved ?? 1;
  return (
    <section className="card" aria-labelledby="work-title">
      <p className="eyebrow">The work</p>
      <h2 className="h3" id="work-title">
        What to actually do, in order.
      </h2>
      <ol className="work">
        {actions.map((action, i) => (
          <li key={action.id}>
            <details>
              <summary>
                <span className="work-rank">{i + 1}</span>
                <span className="work-main">
                  <b>
                    Upgrade <span className="mono">{action.pkg}</span> to {action.fixVersion}
                  </b>
                  <span>
                    {action.urgent.length} urgent on {action.assets.length} asset{action.assets.length === 1 ? '' : 's'} ·{' '}
                    {action.owners.join(', ')}
                    {action.alsoCloses > 0 && ` · also closes ${action.alsoCloses} lower-priority`}
                  </span>
                </span>
                <span className="work-bar" aria-hidden="true">
                  <i style={{ width: `${(action.riskRemoved / max) * 100}%` }} />
                </span>
                <span className="work-score" title="Sum of the urgent findings’ risk scores">
                  {formatNumber(action.riskRemoved)}
                </span>
              </summary>
              <ul className="work-findings">
                {action.urgent.map((u) => (
                  <li key={u.finding.key}>
                    <div>
                      <b>{u.vuln.title}</b> on <span className="mono">{u.asset.id}</span>
                      <div className="factors">
                        {u.risk.factors.map((factor) => (
                          <span className="chip" key={factor.label}>
                            {factor.value}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="work-finding-side">
                      <span className="chip chip-bad">score {u.risk.score}</span>
                      <button type="button" className="link-btn" onClick={() => onFollow(u.finding.key)}>
                        Follow it
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ol>
      {result.actions.length > 5 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${result.actions.length}`}
        </button>
      )}
    </section>
  );
}

// ── Follow one finding ────────────────────────────────────────────────

const STORIES: { label: string; test: (f: AssessedFinding) => boolean }[] = [
  { label: 'Vanished for one scan', test: (f) => has(f, 'reappeared') },
  { label: 'On a page that never loaded', test: (f) => has(f, 'held_incomplete_scan') },
  { label: 'Its server was offline', test: (f) => has(f, 'held_asset_not_scanned') },
  { label: 'Updates arrived out of order', test: (f) => f.finding.history.some((h) => h.code === 'stale_ignored' && h.cycle > 1) },
  { label: 'The feed forgot to mention it', test: (f) => has(f, 'drift_repaired') },
  { label: 'Fixed, then came back', test: (f) => f.finding.history.some((h) => h.code === 'reopened' && h.cycle > 1) },
  { label: 'Seen by all three scanners', test: (f) => Object.keys(f.finding.obs).length === 3 },
  { label: 'Fixed, and confirmed', test: (f) => has(f, 'absence_confirmed') && f.finding.status === 'resolved' },
];

function has(f: AssessedFinding, code: DecisionCode): boolean {
  return f.finding.history.some((h) => h.code === code);
}

const STATUS_LABEL: Record<FindingStatus, string> = { open: 'open', pending: 'pending', resolved: 'closed' };
const STATUS_CHIP: Record<FindingStatus, string> = { open: 'chip-bad', pending: 'chip-warn', resolved: 'chip-good' };

interface StoryProps {
  result: SimulationResult;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export function FindingStory({ result, selectedKey, onSelect }: StoryProps) {
  const stories = useMemo(() => {
    // Prefer the highest-risk example of each story: more is at stake when it goes wrong.
    const ranked = [...result.findings].sort((a, b) => b.risk.score - a.risk.score);
    return STORIES.flatMap((story) => {
      const match = ranked.find(story.test);
      return match ? [{ label: story.label, key: match.finding.key }] : [];
    });
  }, [result]);
  const truthByKey = useMemo(() => new Map(result.world.truth.map((t) => [t.key, t])), [result]);
  const key = selectedKey ?? stories[0]?.key ?? result.findings[0]?.finding.key;
  const item = result.findings.find((f) => f.finding.key === key);
  if (!item) return null;
  const truth = truthByKey.get(item.finding.key);
  const cycles = Array.from({ length: CYCLES }, (_, i) => i + 1);

  return (
    <section className="card story" aria-labelledby="story-title">
      <p className="eyebrow">Follow one finding</p>
      <h2 className="h3" id="story-title">
        Totals hide the interesting part. Pick a finding with a story.
      </h2>
      <div className="story-picks" role="group" aria-label="Example findings">
        {stories.map((story) => (
          <button key={story.label} type="button" aria-pressed={story.key === key} onClick={() => onSelect(story.key)}>
            {story.label}
          </button>
        ))}
      </div>

      <div className="story-head">
        <div>
          <b>{item.vuln.title}</b>
          <span className="mono">
            {item.finding.id} · {item.asset.id} · {item.vuln.id}
          </span>
        </div>
        <div className="factors">
          <span className={`chip ${BAND_CHIP[item.risk.band]}`}>
            {BAND_LABEL[item.risk.band]} · {item.risk.score}
          </span>
          <span className="chip">{formatNumber(item.finding.alertCount)} alerts → 1 finding</span>
          <span className="chip">{Object.keys(item.finding.obs).join(' + ')}</span>
        </div>
      </div>

      <div className="story-scroll">
        <table className="story-grid">
          <caption className="sr-only">Reality compared with the pipeline’s belief, scan by scan</caption>
          <thead>
            <tr>
              <td />
              {cycles.map((c) => (
                <th key={c} scope="col">
                  Scan {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">In reality</th>
              {cycles.map((c) => {
                const present = truth?.active[c - 1] ?? false;
                return (
                  <td key={c}>
                    <span className={`chip ${present ? 'chip-bad' : 'chip-good'}`}>{present ? 'present' : 'gone'}</span>
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row">Pipeline says</th>
              {cycles.map((c) => {
                const status = item.finding.statusByCycle[c - 1] ?? null;
                return (
                  <td key={c}>
                    {status ? <span className={`chip ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span> : <span className="chip">not seen yet</span>}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <ol className="story-log">
        {item.finding.history.map((entry, i) => (
          <li key={i}>
            <span className="mono">scan {entry.cycle}</span>
            <span>{entry.detail.charAt(0).toUpperCase() + entry.detail.slice(1)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
