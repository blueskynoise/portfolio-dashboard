import { Contact } from '../components/Chrome';
import { Preview } from '../components/Previews';
import { projects, type Project } from '../content/projects';
import { profile } from '../content/site';
import { useDocumentTitle } from '../lib/hooks';
import { asset, Ext, Link } from '../lib/router';

export function CaseStudy({ project }: { project: Project }) {
  useDocumentTitle(`${project.name} — ${profile.name}`);
  const index = projects.indexOf(project);
  const others = [1, 2, 3].map((offset) => projects[(index + offset) % projects.length] as Project);
  const tone = { '--wash': project.wash, '--tone': project.accent } as React.CSSProperties;

  return (
    <>
      <main id="main" tabIndex={-1} style={tone}>
        <header className="case-hero">
          <div className="wrap">
            <Link to="/#projects" className="crumb">
              <span aria-hidden="true">←</span> All projects
            </Link>
            <div className="case-hero-grid">
              <div className="enter">
                <p className="eyebrow">{project.tag}</p>
                <h1 className="display">{project.name}</h1>
                <p className="lede">{project.summary}</p>
                <ul className="facets">
                  {project.facets.map((facet) => (
                    <li key={facet} className="chip">
                      {facet}
                    </li>
                  ))}
                </ul>
                <div className="hero-cta">
                  <Ext className="btn btn-primary" href={project.url}>
                    {project.linkLabel} <span aria-hidden="true">↗</span>
                  </Ext>
                </div>
              </div>
              <img src={asset(project.logo)} alt={`${project.name} logo`} width="500" height="500" />
            </div>
          </div>
        </header>

        <section className="section">
          <div className="wrap case-split">
            <div className="prose">
              <p className="eyebrow">The problem</p>
              <h2>{project.problem.title}</h2>
              {project.problem.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <div className="prose">
              <p className="eyebrow">The approach</p>
              <h2>{project.approach.title}</h2>
              {project.approach.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
        </section>

        {project.hasPreview && (
        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Try the idea</p>
              <h2 className="h2">{project.principle}</h2>
            </div>
            <div className="preview-frame">
              <div className="preview-bar">
                <span>A sketch of the idea, built for this page</span>
                <span>Not the real {project.name} interface</span>
              </div>
              <div className="preview-body">
                <Preview slug={project.slug} />
              </div>
            </div>
          </div>
        </section>
        )}

        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Decisions</p>
              <h2 className="h2">{project.kind === 'podcast' ? 'What the show commits to' : 'What the design commits to'}</h2>
            </div>
            <ol className="decisions">
              {project.decisions.map((d, i) => (
                <li className="decision" key={d.title}>
                  <span className="n" aria-hidden="true">
                    0{i + 1}
                  </span>
                  <h3 className="h3">{d.title}</h3>
                  <p>{d.body}</p>
                </li>
              ))}
            </ol>
            <h3 className="eyebrow" style={{ margin: '48px 0 16px' }}>
              {project.flow.title}
            </h3>
            <ol className="flow">
              {project.flow.steps.map((s) => (
                <li key={s.does}>
                  <b>{s.who}</b>
                  {s.does}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="case-principle wrap">
          <p className="eyebrow">In one line</p>
          <p className="pullquote" style={{ maxWidth: '22ch' }}>
            {project.closing}
          </p>
          <div className="hero-cta" style={{ justifyContent: 'center' }}>
            <Ext className="btn btn-ghost" href={project.url}>
              {project.linkLabel} <span aria-hidden="true">↗</span>
            </Ext>
          </div>
        </section>

        <section className="section">
          <nav className="wrap" aria-label="More projects">
            <p className="eyebrow" style={{ marginBottom: 16 }}>
              More projects
            </p>
            <div className="case-next">
              {others.map((o) => (
                <Link key={o.slug} to={`/work/${o.slug}`}>
                  <span className="eyebrow">{o.tag}</span>
                  <b>{o.name}</b>
                </Link>
              ))}
            </div>
          </nav>
        </section>
      </main>
      <Contact />
    </>
  );
}
