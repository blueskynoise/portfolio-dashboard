import { useMemo, useState, type ReactNode } from 'react';
import {
  AUTOMATION_DAY,
  analyze,
  buildModel,
  coverageSeries,
  CURRENT,
  dayToIso,
  DEFAULT_VIEW,
  END_DAY,
  generateSources,
  ownershipCoverage,
  SLA_DAYS,
  tell,
  ageAt,
  type Finding,
  type IngestRun,
  type Model,
  type Ownership,
  type SeverityFilter,
  type Statement,
  type Story,
  type View,
} from '@portfolio/analytics';
import { Contact } from '../components/Chrome';
import { profile } from '../content/site';
import { useDocumentTitle } from '../lib/hooks';
import { Ext } from '../lib/router';
import { ArrivalsChart, BacklogChart, CoverageChart, FlowBreakdown } from '../program/charts';

const n = (value: number): string => value.toLocaleString('en-US');
const pct = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
const days = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value)}d`);
const date = (day: number): string => dayToIso(day).slice(0, 10);

const KIND_LABEL: Record<Statement['kind'], string> = { computed: 'Computed', explanation: 'Explanation', hypothesis: 'Hypothesis', caveat: 'Caveat' };
const KIND_CLASS: Record<Statement['kind'], string> = { computed: 'chip-good', explanation: 'chip-info', hypothesis: 'chip-warn', caveat: '' };
const OWNERSHIP_LABEL: Record<Ownership, string> = { verified: 'Verified owner', stale: 'Out-of-date owner', missing: 'No owner on record', unreconciled: 'Not tied to a service' };
const OWNERSHIP_HELP: Record<Ownership, string> = {
  verified: 'Tagged to a service whose catalog entry names the team that owns it today.',
  stale: 'The catalog names a team that no longer owns the service.',
  missing: 'Tagged to a service, but the catalog has no owner for it.',
  unreconciled: 'No service tag, so there is nothing to look an owner up by.',
};

function Statements({ items }: { items: Statement[] }) {
  return (
    <ul className="statements">
      {items.map((s) => (
        <li key={s.text}>
          <span className={`chip ${KIND_CLASS[s.kind]}`}>{KIND_LABEL[s.kind]}</span>
          <p>{s.text}</p>
        </li>
      ))}
    </ul>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── One finding, all the way back to its source records ───────────────

function FindingDetail({ finding, model }: { finding: Finding; model: Model }) {
  const { sources } = model;
  const raw = finding.sources.map((ref) => ({
    ref,
    record: ref.source === 'cloud_scanner' ? sources.cloudIssues.find((i) => i.id === ref.id) : sources.dependencyIssues.find((i) => i.issue_id === ref.id),
  }));
  const ticket = sources.tickets.find((t) => t.key === finding.ticketKey);
  const asset = sources.inventory.find((a) => a.id === finding.assetId);
  const service = finding.service ? sources.catalog.find((s) => s.name === finding.service) : undefined;
  return (
    <div className="finding-detail">
      <div>
        <h4>How ownership was resolved</h4>
        <ol className="lineage">
          <li>
            Inventory asset <code>{finding.assetId}</code>, tags: <code>{JSON.stringify(asset?.tags ?? {})}</code>
          </li>
          <li>
            {finding.service ? (
              <>
                Service catalog entry <code>{finding.service}</code>: owner <code>{service?.owner ?? 'none'}</code>
                {service?.owner ? (service.ownerCurrent ? ', current' : ', no longer current') : ''}
              </>
            ) : (
              'No service tag, so the catalog cannot be consulted.'
            )}
          </li>
          <li>
            Result: <b>{OWNERSHIP_LABEL[finding.ownership]}</b>. {OWNERSHIP_HELP[finding.ownership]}
          </li>
        </ol>
        <h4>Open periods</h4>
        <ul className="lineage">
          {finding.intervals.map((interval, i) => (
            <li key={i}>
              {date(interval.from)} → {interval.to === null ? 'still open' : date(interval.to)}
              {i > 0 ? ' (reopened)' : ''}
            </li>
          ))}
          {finding.closedAs && <li>Last closed as: {finding.closedAs === 'risk_accepted' ? 'accepted risk (the scanner still reports it)' : 'remediated'}</li>}
        </ul>
        <h4>Ticket</h4>
        {ticket ? (
          <ul className="lineage">
            <li>
              <code>{ticket.key}</code>, opened {ticket.createdAt.slice(0, 10)}, routed by {ticket.routedBy}
            </li>
            {ticket.assignments.length === 0 && <li>Never assigned to a team.</li>}
            {ticket.assignments.map((a, i) => (
              <li key={i}>
                {i === 0 ? 'Assigned to' : 'Re-routed to'} {a.team} on {a.at.slice(0, 10)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No ticket had been opened by the end of the period.</p>
        )}
      </div>
      <div>
        <h4>
          Source records ({raw.length}) {raw.length > 1 && <span className="chip chip-info">merged into one finding</span>}
        </h4>
        {raw.map(({ ref, record }) => (
          <figure key={ref.id} className="raw">
            <figcaption>{ref.source.replace('_', ' ')}</figcaption>
            <pre tabIndex={0}>{JSON.stringify(record, null, 2)}</pre>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ── Engineering view ──────────────────────────────────────────────────

const STATUS_CLASS: Record<IngestRun['status'], string> = { ok: 'run-ok', backfilled: 'run-backfill', partial: 'run-partial', auth_failed: 'run-failed', zero_result_quarantined: 'run-quarantine' };
const SOURCE_ROWS: IngestRun['source'][] = ['cloud_scanner', 'dependency_scanner', 'inventory', 'service_catalog', 'ticketing'];

const CONCERNS: { concern: string; handling: string; where: string }[] = [
  { concern: 'Zero-result responses', handling: 'A run far below recent volume is quarantined. Nothing is closed on the strength of an empty answer.', where: 'packages/analytics · pipeline.ts assessRun()' },
  { concern: 'Authentication failures', handling: 'State is held at the last good sync, the weeks are marked, and figures for them are labeled as reconstructed.', where: 'This dataset: dependency scanner, weeks 20–21' },
  { concern: 'Missed windows and backfill', handling: 'The next good run re-reads from the saved position, and the affected weeks stay flagged.', where: 'This dataset: week 22' },
  { concern: 'Duplicate detection', handling: 'Two scanners reporting one vulnerability on one asset is one finding with two witnesses.', where: 'pipeline.ts mergeBySameFinding()' },
  { concern: 'Asset identity correlation', handling: 'Each source’s naming is normalized to one key. A finding on an asset the inventory does not know is set aside, not guessed at.', where: 'pipeline.ts normalize*(), buildModel()' },
  { concern: 'Incomplete ownership records', handling: 'Four distinct states, kept distinct through every metric. "Unknown owner" is never rolled into a default team.', where: 'pipeline.ts resolveOwnership()' },
  { concern: 'False success', handling: 'A 200 response that cannot be parsed or has the wrong shape is recorded as a failure.', where: 'apps/api · http.ts, providers/*' },
  { concern: 'Rate limits, retries and timeouts', handling: 'Every outbound call has a deadline, a bounded retry, a daily budget and a cache. These run for real in the access gateway.', where: 'apps/api · http.ts, providers/budget.ts' },
  { concern: 'Idempotent processing', handling: 'Building the model twice from the same exports gives the same result; identity is derived from the data, not from arrival order.', where: 'pipeline.ts, covered by tests' },
  { concern: 'Data lineage', handling: 'Every finding keeps references to the source records it was built from. Open any row in the table above.', where: 'model.ts Finding.sources' },
];

function Engineering({ model }: { model: Model }) {
  const [tab, setTab] = useState<'pipeline' | 'health' | 'model' | 'rules' | 'lineage'>('pipeline');
  const { quality, sources, findings } = model;
  const weeks = Array.from({ length: END_DAY / 7 }, (_, i) => i + 1);
  const coverage = useMemo(() => coverageSeries(model), [model]);
  const byOwnership = (status: Ownership): number => findings.filter((f) => f.ownership === status).length;
  const incidents = sources.ingestRuns.filter((r) => r.status !== 'ok');
  const tabs = [['pipeline', 'Pipeline'], ['health', 'Collection health'], ['model', 'Data model'], ['rules', 'Rules'], ['lineage', 'Lineage']] as const;

  return (
    <section className="card eng" aria-labelledby="eng-title">
      <p className="eyebrow">Explore the engineering</p>
      <h2 className="h2" id="eng-title">
        The charts are the easy part.
      </h2>
      <p className="lede">Every number above is only as good as the pipeline under it. This is that pipeline, with the counts from this run.</p>
      <div className="seg" role="tablist" aria-label="Engineering views">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} aria-checked={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && (
        <div role="tabpanel">
          <ol className="pipeline">
            <li>
              <b>Source systems</b>
              <span>
                {n(quality.recordsIn.cloud)} cloud scanner issues · {n(quality.recordsIn.dependency)} dependency scanner issues · {n(sources.inventory.length)} inventory
                assets · {sources.catalog.length} catalog services · {n(sources.tickets.length)} tickets
              </span>
            </li>
            <li>
              <b>Ingest and validate</b>
              <span>
                {sources.ingestRuns.length} collection runs, {incidents.length} of them not clean. A run is checked against recent volume before it is believed.
              </span>
            </li>
            <li>
              <b>Normalize</b>
              <span>Two dialects into one vocabulary: asset key, vulnerability id, severity band, day numbers.</span>
            </li>
            <li>
              <b>Correlate and deduplicate</b>
              <span>
                {n(quality.duplicatesMerged)} records described a finding another scanner had already reported. {n(quality.recordsIn.cloud + quality.recordsIn.dependency)} records
                became {n(findings.length)} findings; {quality.rejected.length} could not be placed.
              </span>
            </li>
            <li>
              <b>Enrich with ownership</b>
              <span>
                {n(byOwnership('verified'))} verified · {n(byOwnership('stale'))} out of date · {n(byOwnership('missing'))} no owner · {n(byOwnership('unreconciled'))} not tied to a service
              </span>
            </li>
            <li>
              <b>Model history</b>
              <span>Each finding becomes a set of open periods, so the backlog on any past day can be recomputed rather than read from a snapshot.</span>
            </li>
            <li>
              <b>Analytics and automation</b>
              <span>Metrics, the narrative, and the routing rule: assign automatically only where ownership is verified.</span>
            </li>
          </ol>
          <h3 className="h3" style={{ margin: '28px 0 12px' }}>
            What goes wrong in practice, and where it is handled
          </h3>
          <ul className="concerns">
            {CONCERNS.map((c) => (
              <li key={c.concern}>
                <b>{c.concern}</b>
                <span>{c.handling}</span>
                <code>{c.where}</code>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 14, fontSize: 14 }}>
            The synthetic sources are generated in memory, so pagination and incremental cursors are not exercised here. Timeouts, retries, budgets and
            caching are exercised for real by the access gateway on every visit.
          </p>
        </div>
      )}

      {tab === 'health' && (
        <div role="tabpanel">
          <div className="runs-scroll">
            <table className="runs">
              <caption className="sr-only">Collection runs by source and week</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  {weeks.map((w) => (
                    <th key={w} scope="col">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SOURCE_ROWS.map((source) => (
                  <tr key={source}>
                    <th scope="row">{source.replace('_', ' ')}</th>
                    {weeks.map((w) => {
                      const runs = sources.ingestRuns.filter((r) => r.source === source && r.week === w);
                      const worst = runs.find((r) => r.status !== 'ok') ?? runs[0];
                      return (
                        <td key={w} className={worst ? STATUS_CLASS[worst.status] : ''} title={worst ? `Week ${w}: ${worst.status.replace(/_/g, ' ')}` : ''}>
                          <span className="sr-only">{worst?.status.replace(/_/g, ' ')}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="legend">
            <li><i className="run-ok" /> Clean</li>
            <li><i className="run-partial" /> Partial</li>
            <li><i className="run-failed" /> Failed</li>
            <li><i className="run-quarantine" /> Quarantined</li>
            <li><i className="run-backfill" /> Backfilled</li>
          </ul>
          <ul className="incidents">
            {incidents.map((r, i) => (
              <li key={i}>
                <b>
                  Week {r.week} · {r.source.replace('_', ' ')}
                  {r.account ? ` · ${r.account}` : ''}
                </b>
                <span className="chip">{r.status.replace(/_/g, ' ')}</span>
                <p>
                  Received {n(r.recordsReceived)} of about {n(r.recordsExpected)} expected. {r.note}
                </p>
              </li>
            ))}
          </ul>
          <h3 className="h3" style={{ margin: '24px 0 8px' }}>
            Scan coverage of in-scope assets, by week
          </h3>
          <CoverageChart points={coverage} />
          <p className="muted" style={{ fontSize: 14 }}>
            The denominator is the inventory of accounts in scope that week, so bringing new accounts in does not look like a drop. The dips are
            real: accounts mid-enrollment, and a scanner outage in weeks 21–22.
          </p>
        </div>
      )}

      {tab === 'model' && (
        <div role="tabpanel" className="entities">
          {[
            ['Cloud account', sources.accounts.length, 'name, environment, day it entered scanning', 'has many assets'],
            ['Asset', sources.inventory.length, 'account, name, kind, tags', 'tagged to at most one service'],
            ['Service', sources.catalog.length, 'name, tier, owner, whether the owner is current', 'owned by at most one team'],
            ['Source issue', quality.recordsIn.cloud + quality.recordsIn.dependency, 'scanner id, resource, rule, severity, dates', 'one per scanner per finding'],
            ['Finding', findings.length, 'asset, vulnerability, severity, open periods, ownership state', 'built from one or more source issues'],
            ['Ticket', sources.tickets.length, 'issue, routing method, assignment history, resolution', 'at most one per finding'],
            ['Collection run', sources.ingestRuns.length, 'source, week, status, records received and expected', 'explains which weeks to trust'],
            ['Coverage record', sources.coverage.length, 'account, week, assets in inventory, assets scanned', 'the denominator for coverage'],
          ].map(([name, count, fields, relation]) => (
            <article key={name as string}>
              <h3>
                {name} <span>{n(count as number)}</span>
              </h3>
              <p>{fields}</p>
              <p className="muted">{relation}</p>
            </article>
          ))}
        </div>
      )}

      {tab === 'rules' && (
        <div role="tabpanel" className="rules-grid">
          <figure>
            <figcaption>Finding identity</figcaption>
            <pre tabIndex={0}>{`key = account / lower(asset name) :: upper(vulnerability id)

cloud:       resource.account, resource.name, rule
dependency:  "org/<account>.<ASSET>", advisory

port, scanner, scan id and dates are not part of identity`}</pre>
          </figure>
          <figure>
            <figcaption>Merging two scanners’ reports</figcaption>
            <pre tabIndex={0}>{`first seen  = earliest of the two
severity    = highest of the two
open        = open if either says open
closed on   = later date, only once both agree

merging removes a duplicate record,
never an exposure`}</pre>
          </figure>
          <figure>
            <figcaption>Ownership</figcaption>
            <pre tabIndex={0}>{`no service tag                -> unreconciled
tag not in catalog          -> unreconciled
catalog has no owner        -> missing
owner listed, not current     -> stale
owner listed and current      -> verified

route automatically only when verified`}</pre>
          </figure>
          <figure>
            <figcaption>Believing a collection run</figcaption>
            <pre tabIndex={0}>{`request failed            -> hold state
received < 25% of recent  -> quarantine, alert a person
otherwise                 -> accept

"zero findings" is a claim that needs evidence`}</pre>
          </figure>
          <figure>
            <figcaption>Deadlines (policy input)</figcaption>
            <pre tabIndex={0}>{Object.entries(SLA_DAYS).map(([severity, limit]) => `${severity.padEnd(9)} ${limit} days`).join('\n')}</pre>
          </figure>
          <figure>
            <figcaption>Accepted risk</figcaption>
            <pre tabIndex={0}>{`closed by the ticket, not the scanner
not counted as open
not counted as fixed
not counted as a deadline met
carries a review date`}</pre>
          </figure>
        </div>
      )}

      {tab === 'lineage' && (
        <div role="tabpanel" className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Built from</th>
                <th scope="col">Definition and denominator</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Open backlog on a day', 'Finding open periods', 'Findings with a period covering that day. Recomputed, not snapshotted.'],
                ['Backlog change', 'Open backlog at two dates', '(end − start) ÷ start. Not shown when the start is zero.'],
                ['Stable-cohort backlog', 'Findings + account onboarding day', 'The same, restricted to accounts scanned for the whole period.'],
                ['Fixes per week', 'Period end dates, excluding accepted risk', 'Remediations in the window ÷ weeks in the window.'],
                ['Assigned within 7 days', 'Finding first seen + last ticket assignment', 'Of findings detected at least 7 days before the window ended.'],
                ['Deadlines met', 'First seen + deadline by severity', 'Of findings whose deadline fell in the window. Accepted risk does not count as met.'],
                ['Overdue share by ownership', 'Finding ownership state + age', 'Overdue ÷ open, within each ownership state.'],
                ['Re-routing rate', 'Ticket assignment history', 'Tickets with more than one assignment ÷ tickets for assets with an owner on record.'],
                ['Scan coverage', 'Coverage records', 'Assets scanned ÷ inventory assets in accounts in scope that week.'],
                ['Verified ownership', 'Inventory tags + service catalog', 'Assets with a verified owner ÷ all inventory assets.'],
              ].map(([metric, from, definition]) => (
                <tr key={metric}>
                  <th scope="row">{metric}</th>
                  <td>{from}</td>
                  <td>{definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="eng-source">
        The generator, pipeline, metrics and narrative are in <code>packages/analytics</code>, with tests.{' '}
        <Ext className="text-link" href="https://github.com/blueskynoise/portfolio-dashboard">
          Source on GitHub ↗
        </Ext>
      </p>
    </section>
  );
}

// ── The page ──────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<Story['verdict'], string> = {
  scope_expansion: 'Scope expansion',
  deteriorating: 'Deteriorating',
  improving: 'Improving',
  mixed: 'Mixed picture',
  no_baseline: 'No baseline yet',
  too_few: 'Too few to judge',
};
const signed = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}%`);

/** One numbered question: the heading sits outside the cards so the four read as chapters, not as more boxes. */
function Question({ id, number, question, answer, children }: { id: string; number: string; question: string; answer: string; children: ReactNode }) {
  return (
    <section className="q" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header className="q-head">
        <span className="q-number" aria-hidden="true">
          {number}
        </span>
        <div>
          <p className="q-question">{question}</p>
          <h2 className="q-answer" id={`${id}-title`}>
            {answer}
          </h2>
        </div>
      </header>
      <div className="q-body">{children}</div>
    </section>
  );
}

export function Program() {
  useDocumentTitle(`Is the program getting worse? — ${profile.name}`);
  const model = useMemo(() => buildModel(generateSources()), []);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const analysis = useMemo(() => analyze(model, view), [model, view]);
  const story = useMemo(() => tell(model, analysis), [model, analysis]);
  const headline = useMemo(() => analyze(model, DEFAULT_VIEW), [model]);
  const coverage = useMemo(() => ownershipCoverage(model), [model]);
  const set = (patch: Partial<View>): void => {
    // Functional update, so two changes in quick succession both apply.
    setView((current) => ({ ...current, ...patch }));
    setOpenFinding(null);
  };
  const filtered = JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW);
  const overdueTotal = analysis.overSla.count;
  const quarterWeek = CURRENT.from / 7;
  const { current } = analysis;

  return (
    <>
      <main id="main" tabIndex={-1} className="program">
        <header className="wrap program-hero enter">
          <p className="eyebrow">Security program intelligence · interactive case study</p>
          <h1 className="display">
            “Our critical vulnerability backlog grew {Math.round((headline.backlogChange ?? 0) * 100)}% this quarter.{' '}
            <em className="mark">Is the program getting worse?”</em>
          </h1>
          <p className="lede">The answer is in the data under the chart. Change the view and every figure, chart and sentence below is recomputed.</p>
          <p className="synthetic">
            <b>Synthetic data.</b> This company does not exist. No record here comes from any employer, and none of it is the live data this site collects
            about its own visitors.
          </p>
        </header>

        <div className="wrap">
          <section className="filters" aria-label="Change the view">
            <div className="filter">
              <span>Severity</span>
              <div className="seg" role="radiogroup" aria-label="Severity">
                {([['critical', 'Critical'], ['critical_high', 'Critical + high'], ['all', 'All']] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={view.severity === value} onClick={() => set({ severity: value as SeverityFilter })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter">
              <span>Scope</span>
              <div className="seg" role="radiogroup" aria-label="Scope">
                {([['all', 'Everything scanned today'], ['stable', 'Scanned all along'], ['new', 'First scanned this quarter']] as const).map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={view.cohort === value} onClick={() => set({ cohort: value })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Select label="Team" value={view.team ?? ''} options={[['', 'All teams'], ...model.sources.teams.map((t) => [t, t] as const)]} onChange={(v) => set({ team: v || null })} />
            <Select label="Environment" value={view.environment ?? ''} options={[['', 'All'], ['prod', 'Production'], ['staging', 'Staging'], ['dev', 'Development']]} onChange={(v) => set({ environment: (v || null) as View['environment'] })} />
            <Select label="Criticality" value={String(view.tier ?? '')} options={[['', 'All tiers'], ['1', 'Tier 1'], ['2', 'Tier 2'], ['3', 'Tier 3']]} onChange={(v) => set({ tier: v ? (Number(v) as 1 | 2 | 3) : null })} />
            <Select label="Ownership" value={view.ownership ?? ''} options={[['', 'Any'], ...(Object.keys(OWNERSHIP_LABEL) as Ownership[]).map((o) => [o, OWNERSHIP_LABEL[o]] as const)]} onChange={(v) => set({ ownership: (v || null) as Ownership | null })} />
            {filtered && (
              <button type="button" className="link-btn" onClick={() => setView(DEFAULT_VIEW)}>
                Reset
              </button>
            )}
          </section>
        </div>

        {/* Stays in view while scrolling: whatever the filters say, the verdict and the numbers behind it are one glance away. */}
        <div className="scorecard-dock">
          <section className={`wrap scorecard scorecard-${story.verdict}`} aria-label="Summary of the current view" aria-live="polite">
            <div className="score-verdict">
              <span>Reading</span>
              <b>{VERDICT_LABEL[story.verdict]}</b>
            </div>
            <dl>
              <div>
                <dt>Backlog</dt>
                <dd>
                  {n(current.start)} → {n(current.end)}
                  {current.start > 0 && <small>{signed(analysis.backlogChange)}</small>}
                </dd>
              </div>
              <div>
                <dt>Scanned all along</dt>
                <dd>{view.cohort === 'new' ? 'n/a' : signed(analysis.stable.backlogChange)}</dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd>
                  {n(overdueTotal)}
                  <small>of {n(analysis.overSla.open)}</small>
                </dd>
              </div>
              <div>
                <dt>Assigned in 7 days</dt>
                <dd>{pct(analysis.assignment.current.withinWeekRate)}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd className={story.confidence.level === 'reduced' ? 'is-reduced' : ''}>{story.confidence.level}</dd>
              </div>
            </dl>
            <nav aria-label="Jump to a question">
              <a href="#what">What</a>
              <a href="#why">Why</a>
              <a href="#do">Do</a>
              <a href="#measure">Measure</a>
            </nav>
          </section>
        </div>

        <div className="wrap program-body">
          <section className={`verdict verdict-${story.verdict}`}>
            <div>
              <p className="eyebrow">Reading of this view · {n(analysis.matched)} findings</p>
              <h2>{story.headline}</h2>
              <p>{story.conclusion}</p>
            </div>
            <p className="confidence">
              <b>Confidence: {story.confidence.level}</b>
              {story.confidence.reasons.length > 0 ? `. ${story.confidence.reasons.join('. ')}.` : '. No collection problems affect this window.'}
            </p>
          </section>

          <Question
            id="what"
            number="01"
            question="What is happening?"
            answer={current.start === 0 ? `${n(current.end)} open, all of them newly visible` : `${n(current.start)} → ${n(current.end)} open (${signed(analysis.backlogChange)})`}
          >
            <div className="card">
              <BacklogChart series={analysis.series} quarterWeek={quarterWeek} />
            </div>
            <div className="two-up">
              <div className="card">
                <h3 className="h3">Where this quarter’s change came from</h3>
                <FlowBreakdown flow={current} />
              </div>
              <div className="plain">
                <Statements items={story.whatIsHappening} />
              </div>
            </div>
          </Question>

          <Question id="why" number="02" question="Why is it happening?" answer="Effort, exposure and data quality are three different things">
            <dl className="kpis">
              <div>
                <dt>Fixes per week</dt>
                <dd>{analysis.throughput.current.toFixed(1)}</dd>
                <p>was {analysis.throughput.previous.toFixed(1)}. Effort.</p>
              </div>
              <div>
                <dt>Assigned within 7 days</dt>
                <dd>{pct(analysis.assignment.current.withinWeekRate)}</dd>
                <p>
                  {n(analysis.assignment.current.assignedWithinWeek)} of {n(analysis.assignment.current.eligible)}; was {pct(analysis.assignment.previous.withinWeekRate)}.{' '}
                  {n(analysis.assignment.current.unassigned)} never assigned.
                </p>
              </div>
              <div>
                <dt>Deadlines met</dt>
                <dd>{pct(analysis.sla.current.rate)}</dd>
                <p>
                  {n(analysis.sla.current.met)} of {n(analysis.sla.current.due)} that came due; was {pct(analysis.sla.previous.rate)}.
                </p>
              </div>
              <div>
                <dt>Open and overdue</dt>
                <dd>{n(overdueTotal)}</dd>
                <p>of {n(analysis.overSla.open)} open. Exposure.</p>
              </div>
              <div>
                <dt>Assets with a verified owner</dt>
                <dd>{pct(coverage.rate)}</dd>
                <p>
                  {n(coverage.verified)} of {n(coverage.assets)}, whole estate. Data quality.
                </p>
              </div>
            </dl>

            <div className="two-up">
              <div className="card">
                <h3 className="h3">Detected against fixed, per week</h3>
                <ArrivalsChart series={analysis.series} quarterWeek={quarterWeek} />
                <h3 className="h3" style={{ marginTop: 20 }}>
                  How old the open work is
                </h3>
                <ul className="aging">
                  {analysis.aging.map((bucket) => (
                    <li key={bucket.label}>
                      <span>{bucket.label}</span>
                      <span className="aging-track">
                        <i style={{ width: `${analysis.overSla.open === 0 ? 0 : (bucket.count / analysis.overSla.open) * 100}%` }} />
                      </span>
                      <b>{n(bucket.count)}</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="plain">
                <Statements items={story.whyIsItHappening} />
              </div>
            </div>

            <details className="card disclosure" open>
              <summary>By ownership state</summary>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Ownership</th>
                      <th scope="col" className="num">Open</th>
                      <th scope="col" className="num">Share of open</th>
                      <th scope="col" className="num">Overdue</th>
                      <th scope="col" className="num">Overdue rate</th>
                      <th scope="col" className="num">Median age</th>
                      <th scope="col" className="num">Never assigned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.ownership.map((row) => (
                      <tr key={row.ownership}>
                        <th scope="row" title={OWNERSHIP_HELP[row.ownership]}>
                          <button type="button" className="link-btn" onClick={() => set({ ownership: row.ownership })}>
                            {OWNERSHIP_LABEL[row.ownership]}
                          </button>
                        </th>
                        <td className="num">{n(row.open)}</td>
                        <td className="num">{pct(row.openShare)}</td>
                        <td className="num">{n(row.overSla)}</td>
                        <td className="num">{pct(row.overSlaRate)}</td>
                        <td className="num">{days(row.medianAgeDays)}</td>
                        <td className="num">{n(row.unassigned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details className="card disclosure">
              <summary>By team</summary>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col" className="num">Open</th>
                      <th scope="col" className="num">Overdue</th>
                      <th scope="col" className="num">Overdue rate</th>
                      <th scope="col" className="num">Median age</th>
                      <th scope="col" className="num">Fixed this quarter</th>
                      <th scope="col" className="num">Tickets re-routed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.teams.map((row) => (
                      <tr key={row.team}>
                        <th scope="row">
                          <button type="button" className="link-btn" onClick={() => set({ team: row.team })}>
                            {row.team}
                          </button>
                        </th>
                        <td className="num">{n(row.open)}</td>
                        <td className="num">{n(row.overSla)}</td>
                        <td className="num">{pct(row.overSlaRate)}</td>
                        <td className="num">{days(row.medianAgeDays)}</td>
                        <td className="num">{n(row.remediated)}</td>
                        <td className="num">{pct(row.reassignedRate)}</td>
                      </tr>
                    ))}
                    {analysis.teams.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted">
                          No finding in this view has reached a team.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
                Findings that never reached a team are in no row of this table. They are the “never assigned” column under ownership.
              </p>
            </details>
          </Question>

          <Question id="do" number="03" question="What should we do?" answer={story.whatShouldWeDo ? 'One recommendation, and what to leave alone' : 'Nothing, on this evidence'}>
            {story.whatShouldWeDo ? (
              <>
                <div className="reco">
                  <p className="eyebrow">Recommendation</p>
                  <h3>{story.whatShouldWeDo.action}</h3>
                  <p>{story.whatShouldWeDo.rationale}</p>
                </div>
                {story.whatShouldWeDo.keep.length > 0 && (
                  <div className="card">
                    <h3 className="h3">Leave these alone</h3>
                    <ul className="keep">
                      {story.whatShouldWeDo.keep.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="muted" style={{ fontSize: 14 }}>
                      Automated routing went live on {date(AUTOMATION_DAY)}, part-way through the previous quarter, which is why the two can be compared.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="card">The view is too narrow to act on. Widen the filters.</p>
            )}
          </Question>

          {story.howWillWeKnow.length > 0 && (
            <Question id="measure" number="04" question="How will we know it worked?" answer="Decide the measurements before the work starts">
              <ol className="measures">
                {story.howWillWeKnow.map((m) => (
                  <li key={m.metric}>
                    <div>
                      <span>{m.metric}</span>
                      <b>{m.baseline}</b>
                    </div>
                    <p>{m.watchFor}</p>
                  </li>
                ))}
              </ol>
            </Question>
          )}

          <div className="deeper" role="separator">
            <span>Go deeper</span>
          </div>

          <section className="card" aria-labelledby="oldest">
            <p className="eyebrow">Evidence</p>
            <h2 className="h3" id="oldest">
              The oldest open findings in this view. Open one to trace it back to its source records.
            </h2>
            <div className="table-scroll">
              <table className="data findings">
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Vulnerability</th>
                    <th scope="col">Severity</th>
                    <th scope="col" className="num">Age</th>
                    <th scope="col">Ownership</th>
                    <th scope="col">Team</th>
                    <th scope="col">Seen by</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.oldest.map((f) => {
                    const open = openFinding === f.key;
                    return [
                      <tr key={f.key} className={open ? 'is-open' : ''}>
                        <th scope="row">
                          <button type="button" className="link-btn mono" aria-expanded={open} onClick={() => setOpenFinding(open ? null : f.key)}>
                            {f.account}/{f.assetName}
                          </button>
                        </th>
                        <td className="mono">{f.vulnId}</td>
                        <td>
                          <span className={`chip ${f.severity === 'critical' ? 'chip-bad' : f.severity === 'high' ? 'chip-warn' : ''}`}>{f.severity}</span>
                        </td>
                        <td className="num">{days(ageAt(f, END_DAY))}</td>
                        <td>{OWNERSHIP_LABEL[f.ownership]}</td>
                        <td>{f.assignedDay !== null ? f.team : <span className="muted">unassigned</span>}</td>
                        <td>
                          {f.sources.length} scanner{f.sources.length === 1 ? '' : 's'}
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${f.key}-detail`} className="detail-row">
                          <td colSpan={7}>
                            <FindingDetail finding={f} model={model} />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                  {analysis.oldest.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        Nothing is open in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <Engineering model={model} />
        </div>
      </main>
      <Contact />
    </>
  );
}
