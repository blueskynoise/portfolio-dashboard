import { useEffect, useMemo, useState } from 'react';
import { Architecture } from '../components/avalanche/Architecture';
import { StageInspector, StageRail } from '../components/avalanche/Pipeline';
import { FindingStory, Funnel, VerificationCard, WorkList } from '../components/avalanche/Results';
import { Contact } from '../components/Chrome';
import { DEFAULT_CONFIG, FAULTS, SIZES } from '../content/avalanche';
import { profile } from '../content/site';
import { formatNumber, useDocumentTitle, useReducedMotion } from '../lib/hooks';
import {
  ALL_FAULTS,
  CYCLES,
  FAULT_KEYS,
  NAIVE_POLICY,
  NO_FAULTS,
  STAGE_ORDER,
  runSimulation,
  type SimConfig,
  type StageId,
} from '../sim';

const STEPS = CYCLES * STAGE_ORDER.length;
const STEP_MS = 170;

export function Avalanche() {
  useDocumentTitle(`The Great Alert Avalanche — ${profile.name}`);
  const reduced = useReducedMotion();

  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const [started, setStarted] = useState(false);
  /** How many (scan, stage) steps have been revealed so far. */
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState<{ cycle: number; stage: StageId }>({ cycle: 1, stage: 'ingest' });
  const [followed, setFollowed] = useState<string | null>(null);

  const anyFault = FAULT_KEYS.some((key) => config.faults[key]);
  const result = useMemo(() => (started ? runSimulation(config) : null), [config, started]);
  const naive = useMemo(() => (started ? runSimulation(config, NAIVE_POLICY) : null), [config, started]);
  const clean = useMemo(
    () => (started && anyFault ? runSimulation({ ...config, faults: NO_FAULTS }) : null),
    [config, started, anyFault],
  );

  const playing = started && progress < STEPS;
  const done = started && progress >= STEPS;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const next = progress + 1;
      setProgress(next);
      const step = Math.min(next, STEPS - 1);
      setView({ cycle: Math.floor(step / STAGE_ORDER.length) + 1, stage: STAGE_ORDER[step % STAGE_ORDER.length] as StageId });
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, progress]);

  const start = (next?: SimConfig) => {
    if (next) setConfig(next);
    setStarted(true);
    setFollowed(null);
    if (reduced) {
      setProgress(STEPS);
      setView({ cycle: CYCLES, stage: 'prioritize' });
    } else {
      setProgress(0);
      setView({ cycle: 1, stage: 'ingest' });
    }
  };
  /** Changing a control re-runs straight away once the visitor has started. */
  const update = (next: SimConfig) => (started ? start(next) : setConfig(next));
  const finish = () => setProgress(STEPS);
  const look = (cycle: number, stage: StageId) => {
    finish();
    setView({ cycle, stage });
  };

  const report = result?.cycles[view.cycle - 1];
  const activeStep = playing ? progress : null;
  const allOn = FAULT_KEYS.every((key) => config.faults[key]);

  return (
    <>
      <main id="main" tabIndex={-1} className="av">
        <header className="wrap av-hero enter">
          <p className="eyebrow">The Great Alert Avalanche · synthetic data</p>
          <h1 className="display">
            10,000 alerts. <em className="mark">How many actually matter?</em>
          </h1>
          <p className="lede">
            Three fictional scanners report on the same fleet for five scans. They overlap, repeat themselves, and go
            quiet at bad moments. The pipeline below has to work out what is real, what is still open, and what is worth
            someone’s afternoon. Choose what goes wrong, then run it.
          </p>
        </header>

        <section className="wrap" aria-label="Simulation controls">
          <div className="card controls">
            <div className="controls-row">
              <fieldset className="field">
                <legend className="eyebrow">Alerts</legend>
                <div className="seg" role="radiogroup" aria-label="Number of alerts">
                  {SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={config.alertCount === size}
                      onClick={() => update({ ...config, alertCount: size })}
                    >
                      {formatNumber(size)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="field">
                <p className="eyebrow">Dataset</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ ...config, seed: config.seed + 1 })}>
                  #{config.seed} · shuffle
                </button>
              </div>
              <div className="controls-run">
                {playing ? (
                  <button type="button" className="btn btn-ghost" onClick={finish}>
                    Skip to the end
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => start()}>
                    {started ? 'Run it again' : 'Run the avalanche'} <span className="arrow" aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            </div>

            <fieldset className="field">
              <legend className="eyebrow">
                What goes wrong
                <button type="button" className="link-btn" onClick={() => update({ ...config, faults: allOn ? NO_FAULTS : ALL_FAULTS })}>
                  {allOn ? 'calm everything down' : 'break everything'}
                </button>
              </legend>
              <div className="faults">
                {FAULTS.map((fault) => {
                  const on = config.faults[fault.key];
                  return (
                    <button
                      key={fault.key}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      className="fault"
                      onClick={() => update({ ...config, faults: { ...config.faults, [fault.key]: !on } })}
                    >
                      <span className="switch" aria-hidden="true" />
                      <span>
                        <b>{fault.label}</b>
                        <span>{fault.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </section>

        {!result || !report ? (
          <section className="wrap av-empty">
            <p>
              Nothing has run yet. The defaults are an ordinary day: some rate limiting, some duplicates.{' '}
              <button type="button" className="link-btn" onClick={() => start()}>
                Run it
              </button>{' '}
              and see what’s left.
            </p>
          </section>
        ) : (
          <>
            <section className="wrap av-pipeline" aria-labelledby="pipeline-title">
              <div className="av-pipeline-head">
                <h2 className="h3" id="pipeline-title">
                  The pipeline, scan by scan
                </h2>
                <div className="scan-tabs" role="group" aria-label="Choose a scan">
                  {Array.from({ length: CYCLES }, (_, i) => i + 1).map((cycle) => {
                    const c = result.cycles[cycle - 1];
                    const trouble = c && (c.transport.failedPages > 0 || !c.sync.lantern.complete || c.sync.harbor.hostsUnreachable > 0);
                    return (
                      <button
                        key={cycle}
                        type="button"
                        aria-pressed={view.cycle === cycle}
                        className={(cycle - 1) * STAGE_ORDER.length < progress ? '' : 'is-waiting'}
                        onClick={() => look(cycle, view.stage)}
                      >
                        Scan {cycle}
                        {trouble && done && <span className="trouble" title="Something went wrong in this scan" aria-label="(trouble)" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="progress" aria-hidden="true">
                <i style={{ width: `${(Math.min(progress, STEPS) / STEPS) * 100}%` }} />
              </div>
              <StageRail
                report={report}
                selected={view.stage}
                activeIndex={activeStep !== null && Math.floor(activeStep / STAGE_ORDER.length) + 1 === view.cycle ? activeStep % STAGE_ORDER.length : null}
                isRevealed={(stageIndex) => (view.cycle - 1) * STAGE_ORDER.length + stageIndex < progress}
                onSelect={(stage) => look(view.cycle, stage)}
              />
              {done ? (
                <StageInspector report={report} stage={view.stage} />
              ) : (
                <p className="av-running" role="status">
                  Scan {view.cycle} of {CYCLES} · {formatNumber(report.snapshot.total)} findings tracked so far
                </p>
              )}
            </section>

            {done && naive && (
              <div className="wrap av-results">
                <p className="sr-only" role="status">
                  Simulation complete. {result.funnel.actNow} of {formatNumber(result.funnel.received)} alerts matter now.
                </p>
                <Funnel result={result} />
                <VerificationCard result={result} naive={naive} clean={clean} />
                <WorkList
                  result={result}
                  onFollow={(key) => {
                    setFollowed(key);
                    document.getElementById('story')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                  }}
                />
                <div id="story">
                  <FindingStory result={result} selectedKey={followed} onSelect={setFollowed} />
                </div>
              </div>
            )}
          </>
        )}

        <div className="wrap av-results">
          <Architecture />
        </div>
      </main>
      <Contact />
    </>
  );
}
