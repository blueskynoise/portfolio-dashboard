import { useEffect, useState } from 'react';
import type { PublicHealth } from '@portfolio/contracts';
import { api } from '../lib/api';

/**
 * Public, aggregate-only health of the gateway over the last week.
 *
 * Nothing here is about any one visitor. Outcome figures are withheld
 * entirely until there have been enough evaluations that a percentage
 * cannot describe an individual.
 */
const STATE_LABEL = { healthy: 'healthy', degraded: 'degraded', no_live_calls: 'no live calls yet', not_configured: 'not configured' } as const;
const STATE_CLASS = { healthy: 'chip-good', degraded: 'chip-bad', no_live_calls: '', not_configured: '' } as const;

export function GatewayHealth() {
  const [health, setHealth] = useState<PublicHealth | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<PublicHealth>('/api/gateway/health')
      .then((h) => live && setHealth(h))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="muted">Gateway health is not available right now.</p>;
  if (!health) return <p className="muted" aria-busy="true">Loading…</p>;

  return (
    <div className="health">
      {health.sufficient && health.decisions && health.latency ? (
        <dl className="kpis">
          <div>
            <dt>Evaluations</dt>
            <dd>{health.evaluations}+</dd>
            <p>last {health.windowDays} days, rounded down</p>
          </div>
          <div>
            <dt>Allowed</dt>
            <dd>{health.decisions.allow}%</dd>
            <p>
              {health.decisions.challenge}% challenged, {health.decisions.deny}% denied
            </p>
          </div>
          <div>
            <dt>Full assurance</dt>
            <dd>{health.standardAssurance}%</dd>
            <p>decided with all the evidence the policy expects</p>
          </div>
          <div>
            <dt>Latency p50 / p95</dt>
            <dd>
              {health.latency.p50} / {health.latency.p95} ms
            </dd>
            <p>server side, including provider calls</p>
          </div>
          <div>
            <dt>Failures counted as passes</dt>
            <dd className={health.failuresCountedAsPasses === 0 ? 'good' : 'bad'}>{health.failuresCountedAsPasses}</dd>
            <p>must be zero</p>
          </div>
        </dl>
      ) : (
        <p className="health-withheld">
          Outcome figures are withheld: there have been fewer than {health.minimumToPublish} evaluations in the last {health.windowDays} days, and with so few
          an aggregate would describe individual visits.
        </p>
      )}
      <ul className="health-providers">
        {health.providers.map((p) => (
          <li key={p.name}>
            <span className="mono">{p.name}</span>
            <span className={`chip ${STATE_CLASS[p.state]}`}>{STATE_LABEL[p.state]}</span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 13 }}>
        Policy {health.policyVersion}. Aggregates only: no network, organization, browser or per-visit detail is published.
      </p>
    </div>
  );
}
