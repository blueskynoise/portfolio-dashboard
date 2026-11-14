import { useEffect, useState } from 'react';
import type { Analysis, Story } from '@portfolio/analytics';
import { Contact } from '../components/Chrome';
import { EvaluationCard } from '../components/EvaluationCard';
import { projects } from '../content/projects';
import { career, credentials, examples, profile, proof, stack } from '../content/site';
import { useDocumentTitle } from '../lib/hooks';
import { asset, Ext, Link } from '../lib/router';

const signedPct = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}%`);

/**
 * The case study's headline finding, from the same computation the case study page runs.
 *
 * The dataset is built after first paint, in a separately loaded chunk, so the hero does not wait on it.
 * Until it arrives the figures are placeholders, never guesses.
 */
function CaseInsight() {
  const [data, setData] = useState<{ analysis: Analysis; story: Story } | null>(null);

  useEffect(() => {
    let live = true;
    const build = (): void => {
      void import('@portfolio/analytics').then(({ analyse, buildModel, DEFAULT_VIEW, generateSources, tell }) => {
        const model = buildModel(generateSources());
        const analysis = analyse(model, DEFAULT_VIEW);
        if (live) setData({ analysis, story: tell(model, analysis) });
      });
    };
    const idle = window.requestIdleCallback ? window.requestIdleCallback(build, { timeout: 1500 }) : window.setTimeout(build, 200);
    return () => {
      live = false;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  const a = data?.analysis;
  const peak = a ? Math.max(...a.series.map((p) => p.open)) : 1;
  return (
    <div className="insight" aria-busy={!data}>
      <div className="insight-copy">
        <p className="eyebrow">Case study · synthetic company</p>
        <p className="insight-question">“Our critical vulnerability backlog grew this quarter. Is the programme getting worse?”</p>
        <dl className="insight-numbers">
          <div>
            <dd>{a ? signedPct(a.backlogChange) : '—'}</dd>
            <dt>across everything scanned today</dt>
          </div>
          <div className="is-answer">
            <dd>{a ? signedPct(a.stable.backlogChange) : '—'}</dd>
            <dt>in the accounts scanned all along</dt>
          </div>
        </dl>
        <h2 className="insight-verdict">{data ? data.story.headline : 'Working it out from the data…'}</h2>
        <Link to="/program" className="btn">
          See the evidence <span className="arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <figure className="insight-figure">
        <div className="teaser-bars" role="img" aria-label={a ? `Open critical findings by week, from ${a.current.start} to ${a.current.end}. The increase is in accounts first scanned this quarter.` : 'Loading'}>
          {(a?.series ?? Array.from({ length: 26 }, (_, i) => ({ week: i + 1, open: 0, openNew: 0 }))).map((p) => (
            <span key={p.week} style={{ height: a ? `${(p.open / peak) * 100}%` : '4%' }}>
              <i style={{ height: `${p.open === 0 ? 0 : (p.openNew / p.open) * 100}%` }} />
            </span>
          ))}
        </div>
        <figcaption>
          <span>
            <i className="key key-stable" /> Scanned all along
          </span>
          <span>
            <i className="key key-new" /> First scanned this quarter
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export function Home() {
  useDocumentTitle(`${profile.name} — ${profile.headline}`);
  return (
    <>
      <main id="main" tabIndex={-1}>
        <section className="hero wrap">
          <div className="hero-grid">
            <div className="enter">
              <p className="eyebrow">{profile.name} · security engineering, data, automation</p>
              <h1 className="display">
                I build the systems that turn <em className="mark">security data</em> into decisions.
              </h1>
              <p className="lede">{profile.intro}</p>
              <div className="hero-cta">
                <Link to="/program" className="btn btn-primary">
                  See the case study
                </Link>
                <Link to="/#experience" className="btn btn-ghost">
                  Experience
                </Link>
                <Link to="/#projects" className="btn btn-ghost">
                  Projects
                </Link>
                <Ext className="btn btn-ghost" href={profile.github}>
                  GitHub <span aria-hidden="true">↗</span>
                </Ext>
              </div>
            </div>
            <EvaluationCard />
          </div>
          <dl className="creds">
            {credentials.map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd>{c.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="band">
          <div className="wrap">
            <CaseInsight />
          </div>
        </section>

        <section className="band band-plain" aria-labelledby="proof-title">
          <div className="wrap">
            <div className="proof-head">
              <h2 className="eyebrow" id="proof-title">
                The site is the demonstration
              </h2>
              <Link to="/access#health" className="text-link">
                Gateway health, live <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ul className="proof">
              {proof.map((p) => (
                <li key={p.title}>
                  <span className="proof-cap">{p.capability}</span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                  <Link to={p.link.to} className="text-link">
                    {p.link.label} <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" id="experience" tabIndex={-1}>
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Experience</p>
              <h2 className="h2">{career.title}</h2>
              <p className="lede">{career.lede}</p>
              <p className="lede">{career.turn}</p>
            </div>
            <ol className="examples">
              {examples.map((e) => (
                <li key={e.title}>
                  <h3 className="h3">{e.title}</h3>
                  <dl>
                    <div>
                      <dt>The problem</dt>
                      <dd>{e.problem}</dd>
                    </div>
                    <div>
                      <dt>What I built</dt>
                      <dd>{e.built}</dd>
                    </div>
                  </dl>
                  <ul className="tools" aria-label="Tools involved">
                    {e.tools.map((t) => (
                      <li key={t} className="chip">
                        {t}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>

            <div className="stack">
              <div>
                <p className="eyebrow">The data work, end to end</p>
                <p className="muted">
                  What each tool was for. The <Link to="/program" className="text-link">case study</Link> shows the same shape of pipeline on a synthetic
                  company, including what happens when a stage fails.
                </p>
              </div>
              <ol>
                {stack.map((s) => (
                  <li key={s.stage}>
                    <span className="eyebrow">{s.stage}</span>
                    <b>{s.tools}</b>
                    <span>{s.role}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="section" id="projects" tabIndex={-1}>
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Things I’ve built and made</p>
              <h2 className="h2">Selected projects</h2>
              <p className="lede">
                Three independent products and a podcast. None is a security tool. They share the habits the security work depends on: put the decision
                with the person who owns it, remove the steps people get wrong, and say plainly what a thing is for.
              </p>
            </div>
            <div className="project-grid">
              {projects.map((p) => (
                <Link key={p.slug} to={`/work/${p.slug}`} className="project" style={{ '--wash': p.wash, '--tone': p.accent } as React.CSSProperties}>
                  <div className="project-art">
                    <img src={asset(p.logo)} alt={`${p.name} logo`} width="500" height="500" loading="lazy" />
                  </div>
                  <div className="project-copy">
                    <p className="eyebrow">{p.tag}</p>
                    <h3>{p.name}</h3>
                    <p className="project-theme">{p.theme}</p>
                    <p className="muted">{p.summary}</p>
                    <span className="more">
                      {p.kind === 'podcast' ? 'About the show' : 'Read the case study'} <span className="arrow" aria-hidden="true">→</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Contact />
    </>
  );
}
