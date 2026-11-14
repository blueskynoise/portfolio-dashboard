import { useMemo } from 'react';
import { Contact } from '../components/Chrome';
import { SocConsole } from '../components/SocConsole';
import { DEFAULT_CONFIG } from '../content/avalanche';
import { projects } from '../content/projects';
import { lenses, onAi, path, podcast, principles, profile } from '../content/site';
import { formatNumber, useDocumentTitle } from '../lib/hooks';
import { asset, Ext, Link } from '../lib/router';
import { NO_FAULTS, runSimulation } from '../sim';

function Teaser() {
  // The preview bars are real output: the default dataset on a day when nothing goes wrong.
  const funnel = useMemo(() => runSimulation({ ...DEFAULT_CONFIG, faults: NO_FAULTS }).funnel, []);
  const rows: [string, number][] = [
    ['alerts received', funnel.received],
    ['distinct findings', funnel.uniqueFindings],
    ['still open', funnel.stillOpen],
    ['matter now', funnel.actNow],
  ];
  return (
    <div className="teaser">
      <div>
        <p className="eyebrow">Interactive · runs in your browser</p>
        <h2 className="h2">10,000 alerts. How many actually matter?</h2>
        <p>
          The Great Alert Avalanche is a working model of the unglamorous middle of security engineering: ingesting
          findings from scanners that disagree, retry, duplicate and forget, and still ending up with a short, honest
          list of things to fix.
        </p>
        <Link to="/avalanche" className="btn">
          Start the avalanche <span className="arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <ol className="teaser-funnel" aria-label="Result of the default simulation run">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span>
              <b>{formatNumber(value)}</b> {label}
            </span>
            <i style={{ width: `${(value / funnel.received) * 100}%` }} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Home() {
  useDocumentTitle(`${profile.name} — Experience solves problems`);
  return (
    <>
      <main id="main" tabIndex={-1}>
        <section className="hero wrap">
          <div className="hero-grid">
            <div className="enter">
              <p className="eyebrow">Security engineering · automation · product</p>
              <h1 className="display">
                <span>{profile.motto[0]}</span>
                <span>
                  <em className="mark">Experience</em> solves problems.
                </span>
              </h1>
              <p className="lede">
                I’m {profile.name}. {profile.intro}
              </p>
              <div className="hero-cta">
                <Link to="/#work" className="btn btn-primary">
                  See the work
                </Link>
                <Link to="/#background" className="btn btn-ghost">
                  How I got here
                </Link>
              </div>
            </div>
            <SocConsole />
          </div>
        </section>

        <section className="section" id="work" tabIndex={-1}>
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Work</p>
              <h2 className="h2">Three products, one habit: find the part people put up with, and fix that.</h2>
              <p className="lede">
                Different audiences, different domains, the same focus: make useful systems easier to understand and
                act on.
              </p>
            </div>
            <div className="work-list">
              {projects.map((p) => (
                <Link
                  key={p.slug}
                  to={`/work/${p.slug}`}
                  className="work-card"
                  style={{ '--wash': p.wash, '--tone': p.accent } as React.CSSProperties}
                >
                  <div className="work-art">
                    <img src={asset(p.logo)} alt={`${p.name} logo`} width="500" height="500" loading="lazy" />
                  </div>
                  <div className="work-copy">
                    <p className="eyebrow">{p.tag}</p>
                    <h3>{p.name}</h3>
                    <p className="principle">{p.principle}</p>
                    <p className="muted">{p.summary}</p>
                    <span className="more">
                      Read the case study <span className="arrow" aria-hidden="true">→</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <Teaser />
          </div>
        </section>

        <section className="section" id="background" tabIndex={-1}>
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Background</p>
              <h2 className="h2">I got into engineering by automating my way out of security paperwork.</h2>
              <p className="lede">
                My underlying view hasn’t changed since the governance days: security should solve real problems, not
                generate complexity or theater.
              </p>
            </div>
            <ol className="path">
              {path.map((item) => (
                <li key={item.step}>
                  <p className="eyebrow">{item.step}</p>
                  <h3 className="h3">{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ol>
            <article className="podcast">
              <img src={asset(podcast.logo)} alt={`${podcast.name} logo`} width="500" height="500" loading="lazy" />
              <div>
                <p className="eyebrow">{podcast.tag}</p>
                <h3>{podcast.name}</h3>
                <p>
                  {podcast.summary} <strong>{podcast.principle}</strong>
                </p>
                {podcast.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <Ext className="text-link" href={podcast.url}>
                  Listen on Spotify ↗
                </Ext>
              </div>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="wrap two-col">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <p className="eyebrow">How I build</p>
              <h2 className="h2">Three lenses</h2>
              <p className="lede">{lenses.intro}</p>
            </div>
            <div>
              <ul className="lens-list">
                {lenses.items.map((lens) => (
                  <li key={lens.title}>
                    <h3 className="h3">{lens.title}</h3>
                    <p>{lens.body}</p>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ marginTop: 20 }}>
                {lenses.close}
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap two-col">
            <div>
              <p className="eyebrow">Principles</p>
              <blockquote className="pullquote" style={{ marginTop: 16 }}>
                “{principles.quote.text}”<cite>— {principles.quote.cite}</cite>
              </blockquote>
            </div>
            <ol className="principle-list">
              {principles.items.map(([title, body], i) => (
                <li key={title}>
                  <span className="n" aria-hidden="true">
                    0{i + 1}
                  </span>
                  <div>
                    <h3 className="h3">{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="wrap two-col">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <p className="eyebrow">On AI</p>
              <h2 className="h2">{onAi.lead}</h2>
            </div>
            <div className="prose">
              <p>{onAi.aside}</p>
              <ul className="ai-callouts">
                {onAi.callouts.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {onAi.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Contact />
    </>
  );
}
