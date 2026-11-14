import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AdminAssessmentRow, AdminOverview, Distribution } from '@portfolio/contracts';
import { profile } from '../content/site';
import { api, ApiError } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';

/**
 * Private operational analytics for the access gateway.
 *
 * The page asks one question of the real data: is the evaluation doing
 * its job? Visitor counts are the least interesting thing on it.
 */

const n = (value: number): string => value.toLocaleString('en-US');
const pct = (value: number | null): string => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
const SEVERITY = { ok: 'chip-good', watch: 'chip-warn', action: 'chip-bad' } as const;

function Dist({ title, items, total }: { title: string; items: Distribution[]; total: number }) {
  return (
    <div className="dist">
      <h3>{title}</h3>
      {items.length === 0 && <p className="muted">No data.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <span>{item.key.replace(/_/g, ' ')}</span>
            <span className="dist-track">
              <i style={{ width: `${total === 0 ? 0 : (item.count / total) * 100}%` }} />
            </span>
            <b>{n(item.count)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Admin() {
  useDocumentTitle(`Gateway operations — ${profile.name}`);
  const [state, setState] = useState<'checking' | 'login' | 'ready' | 'unconfigured'>('checking');
  const [days, setDays] = useState(7);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rows, setRows] = useState<AdminAssessmentRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async (windowDays: number) => {
    try {
      const [o, r] = await Promise.all([api.get<AdminOverview>(`/api/admin/overview?days=${windowDays}`), api.get<AdminAssessmentRow[]>('/api/admin/assessments')]);
      setOverview(o);
      setRows(r);
      setState('ready');
    } catch (cause) {
      setState(cause instanceof ApiError && cause.status === 404 ? 'unconfigured' : 'login');
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const password = new FormData(event.currentTarget).get('password');
    try {
      await api.post('/api/admin/login', { password });
      await load(days);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 429 ? 'Too many attempts. Try again in a few minutes.' : 'That password was not accepted.');
    }
  };
  const flag = async (row: AdminAssessmentRow) => {
    const open = row.investigation?.status !== 'open';
    await api.post(`/api/admin/assessments/${row.id}/investigation`, { status: open ? 'open' : 'closed', note: open ? 'Flagged for false-positive review' : 'Reviewed and closed' });
    await load(days);
  };

  if (state === 'checking') return <main id="main" className="wrap section" aria-busy="true" style={{ minHeight: '60vh' }} />;
  if (state === 'unconfigured') {
    return (
      <main id="main" tabIndex={-1} className="wrap section" style={{ minHeight: '60vh' }}>
        <h1 className="h2">Administration is not configured.</h1>
        <p className="lede" style={{ marginTop: 12 }}>
          Set <code>ADMIN_PASSWORD_HASH</code> on the server to enable it. See the deployment guide.
        </p>
      </main>
    );
  }
  if (state === 'login' || !overview) {
    return (
      <main id="main" tabIndex={-1} className="wrap section" style={{ minHeight: '60vh' }}>
        <form className="card login" onSubmit={(event) => void login(event)}>
          <h1 className="h3">Gateway operations</h1>
          <p className="muted">Private. Aggregate statistics and organization-level network attribution for the access gateway.</p>
          <label>
            <span>Administrator password</span>
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            Sign in
          </button>
        </form>
      </main>
    );
  }

  const o = overview;
  const peak = Math.max(1, ...o.daily.map((d) => d.allow + d.challenge + d.deny));
  return (
    <main id="main" tabIndex={-1} className="program admin">
      <header className="wrap program-hero">
        <p className="eyebrow">Private · live data from this deployment</p>
        <h1 className="h2">Is the access evaluation doing its job?</h1>
        <div className="admin-bar">
          <div className="seg" role="radiogroup" aria-label="Window">
            {[1, 7, 30].map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}>
                {d === 1 ? '24 hours' : `${d} days`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              void api.post('/api/admin/logout').then(() => setState('login'));
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="wrap program-body">
        <section className="card">
          <p className="eyebrow">What needs attention</p>
          <ul className="findings-list">
            {o.findings.map((f) => (
              <li key={f.title}>
                <span className={`chip ${SEVERITY[f.severity]}`}>{f.severity}</span>
                <div>
                  <b>{f.title}</b>
                  <p>{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="kpis">
            <div>
              <dt>Evaluations</dt>
              <dd>{n(o.total)}</dd>
              <p>in the last {o.windowDays === 1 ? '24 hours' : `${o.windowDays} days`}</p>
            </div>
            <div>
              <dt>Latency p50 / p95</dt>
              <dd>
                {o.latency.p50} / {o.latency.p95} ms
              </dd>
              <p>worst {o.latency.max} ms</p>
            </div>
            <div>
              <dt>Failures counted as passes</dt>
              <dd className={o.misclassifiedFailures === 0 ? 'good' : 'bad'}>{o.misclassifiedFailures}</dd>
              <p>must be zero</p>
            </div>
            <div>
              <dt>Decisions on stale data</dt>
              <dd>{o.staleEnrichmentDecisions}</dd>
              <p>enrichment older than its refresh interval</p>
            </div>
            <div>
              <dt>Fingerprint opt-in</dt>
              <dd>{pct(o.fingerprintOptIn.admitted === 0 ? null : o.fingerprintOptIn.optedIn / o.fingerprintOptIn.admitted)}</dd>
              <p>
                {o.fingerprintOptIn.optedIn} of {o.fingerprintOptIn.admitted} admitted
              </p>
            </div>
          </div>
          <div className="daily" role="img" aria-label="Evaluations per day by decision">
            {o.daily.map((d) => (
              <span key={d.day} title={`${d.day}: ${d.allow} allow, ${d.challenge} challenge, ${d.deny} deny`}>
                <i className="deny" style={{ height: `${(d.deny / peak) * 100}%` }} />
                <i className="challenge" style={{ height: `${(d.challenge / peak) * 100}%` }} />
                <i className="allow" style={{ height: `${(d.allow / peak) * 100}%` }} />
              </span>
            ))}
          </div>
        </section>

        <section className="card dist-grid">
          <Dist title="Decisions" items={o.decisions} total={o.total} />
          <Dist title="Assurance" items={o.assurance} total={o.total} />
          <Dist title="Bot verification" items={o.botOutcomes} total={o.total} />
          <Dist title="Session continuity" items={o.sessionContinuity} total={o.total} />
          <Dist title="Policy versions" items={o.policyVersions} total={o.total} />
          <Dist title="Recognition (opted-in only)" items={o.recognition} total={o.fingerprintOptIn.optedIn} />
          <Dist title="Security events" items={o.events} total={o.events.reduce((sum, e) => sum + e.count, 0)} />
        </section>

        <section className="card">
          <p className="eyebrow">Provider reliability</p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col" className="num">Live calls ok</th>
                  <th scope="col" className="num">Cache</th>
                  <th scope="col" className="num">Timeouts</th>
                  <th scope="col" className="num">Errors</th>
                  <th scope="col" className="num">Not called</th>
                  <th scope="col" className="num">Failure rate</th>
                  <th scope="col" className="num">p50 / p95</th>
                  <th scope="col" className="num">Oldest data used</th>
                </tr>
              </thead>
              <tbody>
                {o.providers.map((p) => (
                  <tr key={p.provider}>
                    <th scope="row" className="mono">
                      {p.provider} {p.unconfigured === p.calls && p.calls > 0 && <span className="chip">unconfigured</span>}
                    </th>
                    <td className="num">{n(p.ok)}</td>
                    <td className="num">{n(p.cache)}</td>
                    <td className="num">{n(p.timeout)}</td>
                    <td className="num">{n(p.error)}</td>
                    <td className="num">{n(p.skipped + p.unconfigured)}</td>
                    <td className="num">{pct(p.failureRate)}</td>
                    <td className="num">
                      {p.latency.p50} / {p.latency.p95} ms
                    </td>
                    <td className="num">{p.maxAgeSeconds === null ? 'n/a' : `${Math.round(p.maxAgeSeconds / 60)} min`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
            Failure rate is over calls that reached the provider. Cache hits, unconfigured providers and calls deliberately not made (a private address, a rate-limited client, a spent daily budget) are not in the denominator.
          </p>
        </section>

        <section className="card two-up">
          <div>
            <p className="eyebrow">Signal availability</p>
            <ul className="avail">
              {o.signalAvailability.map((s) => (
                <li key={s.key}>
                  <span>{s.label}</span>
                  <span className="dist-track">
                    <i style={{ width: `${s.rate * 100}%`, background: s.rate < 0.5 ? '#d99a00' : undefined }} />
                  </span>
                  <b>{pct(s.rate)}</b>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">Outcome by browser</p>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Browser</th>
                    <th scope="col" className="num">Evaluations</th>
                    <th scope="col" className="num">Challenged or denied</th>
                  </tr>
                </thead>
                <tbody>
                  {o.browserImpact.map((b) => (
                    <tr key={b.browser}>
                      <th scope="row">{b.browser}</th>
                      <td className="num">{n(b.total)}</td>
                      <td className="num">
                        {n(b.nonAllow)} ({pct(b.rate)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="eyebrow" style={{ margin: '24px 0 10px' }}>
              Organizations seen
            </p>
            {o.organizations.length === 0 ? (
              <p className="muted">None in this window, or no provider configured that supplies them.</p>
            ) : (
              <ul className="orgs">
                {o.organizations.map((org) => (
                  <li key={org.name}>
                    <b>{org.name}</b> <span className="chip">{org.type}</span> · {org.visits} visit{org.visits === 1 ? '' : 's'} · last {org.lastSeen.slice(0, 10)}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Taken from address-registration records. It names a network a connection came through, not a person, and not necessarily an employer.
              Internet providers and hosting companies are left out.
            </p>
          </div>
        </section>

        <section className="card">
          <p className="eyebrow">Recent evaluations</p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Reasons</th>
                  <th scope="col">Network</th>
                  <th scope="col">Browser</th>
                  <th scope="col" className="num">ms</th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="mono">
                      {row.createdAt.slice(5, 16).replace('T', ' ')}
                    </th>
                    <td>
                      <span className={`chip ${row.decision === 'ALLOW' ? 'chip-good' : row.decision === 'DENY' ? 'chip-bad' : 'chip-warn'}`}>{row.decision}</span>
                      {row.assurance === 'reduced' && <span className="chip"> reduced</span>}
                    </td>
                    <td className="mono small">{row.reasonCodes.join(', ')}</td>
                    <td>
                      {row.organization ?? row.network}
                      {row.country ? ` · ${row.country}` : ''}
                    </td>
                    <td>{row.browser}</td>
                    <td className="num">{row.totalMs}</td>
                    <td>
                      {row.decision !== 'ALLOW' || row.investigation ? (
                        <button type="button" className="link-btn" onClick={() => void flag(row)}>
                          {row.investigation?.status === 'open' ? 'Close review' : 'Flag as false positive'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
