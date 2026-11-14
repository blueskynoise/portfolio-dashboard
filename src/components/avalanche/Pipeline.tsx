import { DECISIONS, STAGES } from '../../content/avalanche';
import { formatNumber } from '../../lib/hooks';
import { STAGE_ORDER, type CycleReport, type DecisionCode, type StageId } from '../../sim';

type Tone = 'good' | 'warn' | 'bad' | 'info';
interface Flag {
  text: string;
  tone: Tone;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** The one or two things about a stage that are worth a glance this scan. */
function flags(report: CycleReport, stage: StageId): Flag[] {
  const c = report.stages[stage].counters;
  const out: Flag[] = [];
  const add = (code: DecisionCode, text: (n: number) => string, tone: Tone) => {
    const n = c[code] ?? 0;
    if (n > 0) out.push({ text: text(n), tone });
  };
  switch (stage) {
    case 'ingest':
      add('page_failed', (n) => `${n} page${n > 1 ? 's' : ''} lost`, 'bad');
      add('retry_429', (n) => `${n} × 429`, 'warn');
      add('cursor_held', () => 'cursor held', 'warn');
      break;
    case 'normalize':
      add('rejected', (n) => `${n} rejected`, 'bad');
      break;
    case 'dedupe':
      add('duplicate_dropped', (n) => `${formatNumber(n)} dropped`, 'info');
      break;
    case 'identity':
      add('stale_ignored', (n) => `${n} stale ignored`, 'info');
      add('reopened', (n) => `${n} re-opened`, 'warn');
      add('created', (n) => `${formatNumber(n)} new`, 'info');
      break;
    case 'reconcile':
      add('held_incomplete_scan', (n) => `${n} held`, 'warn');
      add('held_asset_not_scanned', (n) => `${n} held (offline)`, 'warn');
      add('drift_repaired', (n) => `${n} repaired`, 'warn');
      add('absence_pending', (n) => `${n} pending`, 'info');
      add('absence_confirmed', (n) => `${n} closed`, 'good');
      break;
    case 'risk':
      out.push({ text: `${formatNumber(report.bands.schedule)} can wait`, tone: 'info' });
      break;
    case 'prioritize':
      break;
  }
  return out.slice(0, 2);
}

interface RailProps {
  report: CycleReport;
  selected: StageId;
  isRevealed: (stageIndex: number) => boolean;
  activeIndex: number | null;
  onSelect: (stage: StageId) => void;
}

export function StageRail({ report, selected, isRevealed, activeIndex, onSelect }: RailProps) {
  return (
    <ol className="rail" aria-label={`Pipeline stages, scan ${report.cycle}`}>
      {STAGE_ORDER.map((id, index) => {
        const revealed = isRevealed(index);
        const stage = report.stages[id];
        const copy = STAGES[id];
        return (
          <li key={id}>
            <button
              type="button"
              className={`stage${selected === id ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}${revealed ? '' : ' is-waiting'}`}
              aria-pressed={selected === id}
              onClick={() => onSelect(id)}
            >
              <span className="stage-step" aria-hidden="true">
                {index + 1}
              </span>
              <span className="stage-name">{copy.name}</span>
              <span className="stage-value">{revealed ? formatNumber(stage.out) : '–'}</span>
              <span className="stage-unit">{copy.unit}</span>
              <span className="stage-flags">
                {revealed &&
                  flags(report, id).map((flag) => (
                    <span key={flag.text} className={`chip chip-${flag.tone}`}>
                      {flag.text}
                    </span>
                  ))}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SyncStrip({ report }: { report: CycleReport }) {
  const { harbor, lantern, sieve } = report.sync;
  const t = report.transport;
  return (
    <ul className="sync">
      <li>
        <b>harbor</b> full scan · {harbor.pagesRetrieved}/{harbor.pagesTotal} pages
        {harbor.hostsUnreachable > 0 && ` · ${harbor.hostsUnreachable} hosts unreachable`} ·{' '}
        <span className={`chip chip-${harbor.complete ? 'good' : 'bad'}`}>{harbor.complete ? 'complete' : 'incomplete'}</span>
      </li>
      <li>
        <b>lantern</b> change feed · cursor {formatNumber(lantern.cursorBefore)} → {formatNumber(lantern.cursorAfter)} ·{' '}
        <span className={`chip chip-${lantern.complete ? 'good' : 'warn'}`}>{lantern.complete ? 'caught up' : 'will resume'}</span>
      </li>
      <li>
        <b>sieve</b> pushed events · {formatNumber(sieve.deliveries)} deliveries
      </li>
      <li>
        <b>transport</b> {t.requests} requests · {t.rateLimited} × 429 · {t.serverErrors} × 503 · waited {seconds(t.waitedMs)}{' '}
        <span className="muted">(simulated; nothing actually sleeps)</span>
      </li>
    </ul>
  );
}

export function StageInspector({ report, stage }: { report: CycleReport; stage: StageId }) {
  const copy = STAGES[stage];
  const data = report.stages[stage];
  const rows = (Object.keys(DECISIONS) as DecisionCode[])
    .filter((code) => (data.counters[code] ?? 0) > 0)
    .map((code) => ({ code, count: data.counters[code] ?? 0, meta: DECISIONS[code] }));

  return (
    <section className="inspector" aria-live="polite" aria-labelledby="inspector-title">
      <header>
        <p className="eyebrow">
          Scan {report.cycle} · stage {STAGE_ORDER.indexOf(stage) + 1} of {STAGE_ORDER.length}
        </p>
        <h3 className="inspector-title" id="inspector-title">
          {copy.name}: <span>{copy.short}</span>
        </h3>
      </header>
      <div className="inspector-grid">
        <div>
          <p className="inspector-plain">{copy.plain}</p>
          <details className="rule">
            <summary>The rules, for engineers</summary>
            <ul>
              {copy.rule.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="rule-file">{copy.file}</p>
          </details>
        </div>
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            What it decided in scan {report.cycle}
          </p>
          <p className="inout">
            <b>{formatNumber(data.in)}</b> in → <b>{formatNumber(data.out)}</b> out
          </p>
          {stage === 'ingest' && <SyncStrip report={report} />}
          {stage === 'risk' && (
            <ul className="bands">
              <li>
                <span className="chip chip-bad">act now</span> {formatNumber(report.bands.act)}
              </li>
              <li>
                <span className="chip chip-warn">schedule</span> {formatNumber(report.bands.schedule)}
              </li>
              <li>
                <span className="chip">backlog</span> {formatNumber(report.bands.backlog)}
              </li>
            </ul>
          )}
          {rows.length > 0 ? (
            <ul className="decisions-list">
              {rows.map(({ code, count, meta }) => {
                const samples = data.samples.filter((s) => s.code === code).slice(0, 2);
                return (
                  <li key={code}>
                    <div className="decision-row">
                      <span className={`dot dot-${meta?.tone ?? 'plain'}`} aria-hidden="true" />
                      <span>{meta?.label ?? code}</span>
                      <b>{formatNumber(count)}</b>
                    </div>
                    {samples.map((sample) => (
                      <p className="sample" key={sample.text}>
                        {sample.text}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          ) : (
            stage !== 'risk' &&
            stage !== 'ingest' && (
              <p className="muted">
                {stage === 'prioritize'
                  ? report.actions > 0
                    ? `${report.actions} piece${report.actions === 1 ? '' : 's'} of work after this scan. The final list is below.`
                    : 'Nothing urgent enough to interrupt anyone.'
                  : 'Nothing unusual to decide. A quiet stage is a good stage.'}
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
