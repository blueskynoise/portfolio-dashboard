import { useMemo } from 'react';
import { analyse, buildModel, DEFAULT_VIEW, generateSources, tell } from '@portfolio/analytics';
import { Contact } from '../components/Chrome';
import { projects } from '../content/projects';
import { capabilities, career, examples, profile, stack } from '../content/site';
import { useDocumentTitle } from '../lib/hooks';
import { asset, Ext, Link } from '../lib/router';

const signedPct = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}%`);

function CaseTeaser() {
  // Real output from the case-study dataset, so the teaser cannot drift from the page it links to.
  const { analysis, story } = useMemo(() => {
    const model = buildModel(generateSources());
    const a = analyse(model, DEFAULT_VIEW);
    return { analysis: a, story: tell(model, a) };
  }, []);
  const peak = Math.max(...analysis.series.map((p) => p.open));
  return (
    <div className="teaser">
      <div>
        <p className="eyebrow">Interactive case study · synthetic company</p>
        <h2 className="h2">
          “Our critical vulnerability backlog grew {Math.round((analysis.backlogChange ?? 0) * 100)}% this quarter. Is the programme getting worse?”
        </h2>
        <p>
          A bad-looking number, a dataset you can take apart, and the question every security leader eventually gets asked. Work through
          what is happening, why, what to do, and how you would know it worked.
        </p>
        <Link to="/program" className="btn">
          Investigate it <span className="arrow" aria-hidden="true">→</span>
        </Link>
      </div>
      <figure className="teaser-figure">
        <div className="teaser-bars" role="img" aria-label={`Open critical findings by week, rising from ${analysis.current.start} to ${analysis.current.end}.`}>
          {analysis.series.map((p) => (
            <span key={p.week} style={{ height: `${(p.open / peak) * 100}%` }}>
              <i style={{ height: `${p.open === 0 ? 0 : (p.openNew / p.open) * 100}%` }} />
            </span>
          ))}
        </div>
        <figcaption>
          <span>
            <b>{signedPct(analysis.backlogChange)}</b> overall
          </span>
          <span>
            <b>{signedPct(analysis.stable.backlogChange)}</b> where coverage did not change
          </span>
          <span className="teaser-verdict">{story.headline}</span>
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
          <div className="hero-single enter">
            <p className="eyebrow">Security engineering · data · automation</p>
            <h1 className="display">
              I build the systems that turn <em className="mark">security data</em> into decisions.
            </h1>
            <p className="lede">{profile.intro}</p>
            <div className="hero-cta">
              <Link to="/program" className="btn btn-primary">
                Work through the case study
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
          <ul className="caps">
            {capabilities.map((c) => (
              <li key={c.title}>
                <h2>{c.title}</h2>
                <p>{c.body}</p>
                <Link to={c.proof.to} className="text-link">
                  {c.proof.label} <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="section">
          <div className="wrap">
            <CaseTeaser />
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
                  What each tool was for. The <Link to="/program" className="text-link">case study</Link> shows the same shape of
                  pipeline on a synthetic company, including what happens when a stage fails.
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
              <p className="lede">Three independent software products and a podcast. Outside the day job, and built to the same standard.</p>
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
                    <p className="muted">{p.summary}</p>
                    <ul className="facets">
                      {p.facets.slice(0, 3).map((f) => (
                        <li key={f} className="chip">
                          {f}
                        </li>
                      ))}
                    </ul>
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
