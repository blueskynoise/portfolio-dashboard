import { useState } from 'react';
import type { Analysis, CoveragePoint, Flow, WeekPoint } from '@portfolio/analytics';

const n = (value: number): string => value.toLocaleString('en-US');
const W = 760;
const H = 250;
const PAD = { top: 14, right: 12, bottom: 34, left: 44 };

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

/** Weekly backlog, split by whether the account was being scanned all along. */
export function BacklogChart({ series, quarterWeek }: { series: WeekPoint[]; quarterWeek: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((p) => p.open));
  const yTicks = ticks(max);
  const top = yTicks[yTicks.length - 1] === 0 ? 1 : Math.max(max, yTicks[yTicks.length - 1] as number);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / series.length;
  const y = (value: number): number => PAD.top + innerH - (value / top) * innerH;
  const shown = hover !== null ? series[hover] : series[series.length - 1];

  return (
    <figure className="chart">
      <ul className="legend">
        <li>
          <i style={{ background: 'var(--data)' }} /> Accounts scanned all along
        </li>
        <li>
          <i style={{ background: 'var(--accent)' }} /> Accounts first scanned this quarter
        </li>
        <li>
          <i className="legend-caveat" /> Week with a collection problem
        </li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Open findings by week. ${n(series[0]?.open ?? 0)} in week 1, ${n(series[series.length - 1]?.open ?? 0)} in week ${series.length}.`} onMouseLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="axis">
              {n(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.left + band * quarterWeek} x2={PAD.left + band * quarterWeek} y1={PAD.top} y2={H - PAD.bottom + 18} className="divider" />
        <text x={PAD.left + (band * quarterWeek) / 2} y={H - 4} textAnchor="middle" className="axis">
          Previous quarter
        </text>
        <text x={PAD.left + band * quarterWeek + (innerW - band * quarterWeek) / 2} y={H - 4} textAnchor="middle" className="axis">
          This quarter
        </text>
        {series.map((p, i) => {
          const x = PAD.left + i * band + band * 0.14;
          const w = band * 0.72;
          const stableH = (p.openStable / top) * innerH;
          const newH = (p.openNew / top) * innerH;
          return (
            <g key={p.week} opacity={hover === null || hover === i ? 1 : 0.45}>
              <rect x={x} y={y(p.openStable)} width={w} height={Math.max(0, stableH)} rx={2} fill="var(--data)" />
              {p.openNew > 0 && <rect x={x} y={y(p.open)} width={w} height={Math.max(0, newH - 2)} rx={2} fill="var(--accent)" />}
              {p.caveats.length > 0 && <circle cx={x + w / 2} cy={H - PAD.bottom + 8} r={3} className="caveat-dot" />}
              <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH + 14} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      <figcaption aria-live="polite">
        {shown && (
          <>
            <b>Week {shown.week}</b> · {n(shown.open)} open ({n(shown.openStable)} + {n(shown.openNew)} newly scanned) · {n(shown.detected)} detected,{' '}
            {n(shown.remediated)} fixed that week
            {shown.caveats.length > 0 && <span className="caveat-text"> · reconstructed: {shown.caveats.join('; ')}</span>}
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** Where the change in the backlog came from. Bars share one scale so they can be compared by eye. */
export function FlowBreakdown({ flow }: { flow: Flow }) {
  const rows: { label: string; value: number; sign: '+' | '−' | ''; tone: string; note: string }[] = [
    { label: 'Open at the start', value: flow.start, sign: '', tone: 'var(--data)', note: '' },
    { label: 'Found in newly scanned accounts', value: flow.discoveredInNewScope, sign: '+', tone: 'var(--accent)', note: 'Already existed. Newly visible.' },
    { label: 'New in accounts already scanned', value: flow.newInExistingScope, sign: '+', tone: 'var(--data)', note: 'The ordinary inflow.' },
    { label: 'Reopened', value: flow.reopened, sign: '+', tone: 'var(--data)', note: 'A fix that did not hold.' },
    { label: 'Fixed', value: flow.remediated, sign: '−', tone: 'var(--good)', note: 'The underlying issue was remediated.' },
    { label: 'Closed as accepted risk', value: flow.riskAccepted, sign: '−', tone: 'var(--ink-3)', note: 'A documented decision. The exposure remains.' },
    { label: 'Open at the end', value: flow.end, sign: '', tone: 'var(--ink)', note: '' },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flow-rows">
      {rows.map((row) => (
        <li key={row.label} className={row.sign === '' ? 'is-total' : ''}>
          <span className="flow-label">
            {row.label}
            {row.note && <small>{row.note}</small>}
          </span>
          <span className="flow-value">
            {row.value === 0 ? '' : row.sign}
            {n(row.value)}
          </span>
          <span className="flow-track" aria-hidden="true">
            <i style={{ width: `${(row.value / max) * 100}%`, background: row.tone }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Detected against fixed, week by week. Throughput only means something next to arrivals. */
export function ArrivalsChart({ series, quarterWeek }: { series: WeekPoint[]; quarterWeek: number }) {
  const w = 480;
  const h = 200;
  const left = 36;
  const max = Math.max(1, ...series.flatMap((p) => [p.detected, p.remediated]));
  const innerW = w - left - 12;
  const innerH = h - PAD.top - 26;
  const x = (i: number): number => left + (i / (series.length - 1)) * innerW;
  const y = (value: number): number => PAD.top + innerH - (value / max) * innerH;
  const path = (key: 'detected' | 'remediated'): string => series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const boundary = (x(quarterWeek - 1) + x(quarterWeek)) / 2;
  return (
    <figure className="chart chart-small">
      <ul className="legend">
        <li>
          <i style={{ background: 'var(--data)' }} /> Detected
        </li>
        <li>
          <i style={{ background: 'var(--good)' }} /> Fixed
        </li>
      </ul>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Findings detected and fixed per week.">
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={left} x2={left + innerW} y1={y(t)} y2={y(t)} className="grid" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="axis">
              {n(t)}
            </text>
          </g>
        ))}
        <line x1={boundary} x2={boundary} y1={PAD.top} y2={PAD.top + innerH + 8} className="divider" />
        <text x={left + (boundary - left) / 2} y={h - 4} textAnchor="middle" className="axis">
          Previous quarter
        </text>
        <text x={boundary + (left + innerW - boundary) / 2} y={h - 4} textAnchor="middle" className="axis">
          This quarter
        </text>
        <path d={path('detected')} fill="none" stroke="var(--data)" strokeWidth={2} strokeLinejoin="round" />
        <path d={path('remediated')} fill="none" stroke="var(--good)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </figure>
  );
}

export function CoverageChart({ points }: { points: CoveragePoint[] }) {
  return (
    <div className="coverage" role="img" aria-label="Scan coverage of in-scope assets by week.">
      {points.map((p) => (
        <span key={p.week} title={`Week ${p.week}: ${Math.round(p.rate * 100)}% of ${n(p.inventory)} assets in ${p.accounts} accounts`}>
          <i style={{ height: `${p.rate * 100}%`, background: p.rate < 0.9 ? '#d99a00' : 'var(--data)' }} />
        </span>
      ))}
    </div>
  );
}

export function ShareBars({ rows }: { rows: { label: string; a: number | null; b: number | null }[]; }) {
  return (
    <ul className="share-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span>{row.label}</span>
          <span className="share-pair">
            <i style={{ width: `${(row.a ?? 0) * 100}%`, background: 'var(--data)' }} />
            <i style={{ width: `${(row.b ?? 0) * 100}%`, background: 'var(--bad)' }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export type { Analysis };
