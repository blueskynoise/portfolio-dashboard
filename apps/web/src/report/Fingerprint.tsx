import { useState } from 'react';
import type { FingerprintReport, GateConfig } from '@portfolio/contracts';
import { fingerprint as collectFingerprint } from '../gate/collect';
import { api, ApiError } from '../lib/api';
import { SignalList } from './Signals';

/**
 * The opt-in second layer: an actual browser fingerprint, and what it lets
 * us say about whether this browser has been here before.
 */

const RECOGNITION_TONE = { recognised: 'chip-warn', probable: 'chip-warn', possible: 'chip-info', similar: 'chip-info', new: '' } as const;
const RECOGNITION_LABEL = { recognised: 'Recognised', probable: 'Probably returning', possible: 'Possibly returning', similar: 'Similar device seen', new: 'Not seen before' } as const;

export function FingerprintResults({ report }: { report: FingerprintReport }) {
  const { recognition } = report;
  return (
    <div className="fp-results">
      <section className="recog">
        <p className="eyebrow">Have we seen this browser before?</p>
        <h3>
          <span className={`chip ${RECOGNITION_TONE[recognition.status]}`}>{RECOGNITION_LABEL[recognition.status]}</span> {recognition.headline}
        </h3>
        <ul>
          {recognition.evidence.map((item) => (
            <li key={item.text} className={item.supports ? 'for' : 'against'}>
              <span aria-hidden="true">{item.supports ? '+' : '−'}</span>
              <span className="sr-only">{item.supports ? 'Supports a link: ' : 'Argues against a link: '}</span>
              {item.text}
            </li>
          ))}
        </ul>
        <p className="recog-caveat">
          Confidence: <b>{recognition.confidence}</b>. {recognition.caveat}
        </p>
      </section>

      {report.inconsistencies.length > 0 && (
        <section className="incons">
          <p className="eyebrow">Where your browser and your connection disagree</p>
          <ul>
            {report.inconsistencies.map((item) => (
              <li key={item.key}>
                <h4>{item.title}</h4>
                <dl>
                  <div>
                    <dt>Your browser says</dt>
                    <dd>{item.clientSays}</dd>
                  </div>
                  <div>
                    <dt>The connection says</dt>
                    <dd>{item.serverSees}</dd>
                  </div>
                </dl>
                <p>{item.reading}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="eyebrow" style={{ marginBottom: 10 }}>
          What the script read
        </p>
        <SignalList signals={report.signals} />
      </section>
    </div>
  );
}

interface PanelProps {
  existing?: FingerprintReport;
  config: Pick<GateConfig, 'retentionDays'> | null;
  onChange?: (report: FingerprintReport | undefined) => void;
}

export function FingerprintPanel({ existing, config, onChange }: PanelProps) {
  const [report, setReport] = useState<FingerprintReport | undefined>(existing);
  const [state, setState] = useState<'idle' | 'collecting' | 'error'>('idle');
  const [error, setError] = useState('');
  const days = config?.retentionDays ?? 30;

  const run = async () => {
    setState('collecting');
    try {
      const submission = await collectFingerprint();
      const result = await api.post<FingerprintReport>('/api/me/fingerprint', { consent: true, fingerprint: submission });
      setReport(result);
      onChange?.(result);
      setState('idle');
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? 'Your session has ended. Reload to be evaluated again.' : 'The fingerprint could not be collected or stored. Nothing was kept.');
      setState('error');
    }
  };
  const forget = async () => {
    await api.delete('/api/me/fingerprint').catch(() => undefined);
    setReport(undefined);
    onChange?.(undefined);
  };

  if (report) {
    return (
      <div>
        <FingerprintResults report={report} />
        <p className="fp-forget">
          Stored as keyed hashes for {days} days, with a first-party cookie to recognise this browser.{' '}
          <button type="button" className="link-btn" onClick={() => void forget()}>
            Delete my fingerprint and the cookie
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="fp-ask">
      <div>
        <h3>There is a second layer, and it needs your say-so.</h3>
        <p>
          Everything above came from your connection and a few questions any page may ask. A script can go much further: draw hidden
          images and hash how your graphics card renders them, measure which fonts are installed, read your GPU model, time zone,
          screen and core count. Combined, those make a fingerprint that survives cleared cookies and private windows.
        </p>
        <p>
          If you agree, this page will do exactly that, show you every value, and tell you whether your browser matches one it has seen
          before. The fingerprint is stored as keyed hashes for {days} days and a first-party cookie is set so a later visit can be
          linked. You can delete both afterwards. Say no and nothing is collected.
        </p>
      </div>
      <div className="fp-actions">
        <button type="button" className="btn btn-primary" disabled={state === 'collecting'} onClick={() => void run()}>
          {state === 'collecting' ? 'Reading your browser…' : 'Fingerprint my browser'}
        </button>
        {state === 'error' && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
