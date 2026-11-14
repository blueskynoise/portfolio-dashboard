import { Nav } from './components/Chrome';
import { projectBySlug } from './content/projects';
import { Link, useRouter } from './lib/router';
import { useDocumentTitle } from './lib/hooks';
import { Avalanche } from './pages/Avalanche';
import { CaseStudy } from './pages/CaseStudy';
import { Home } from './pages/Home';

function NotFound() {
  useDocumentTitle('Not found — Mark Graziano');
  return (
    <main id="main" tabIndex={-1} className="wrap section" style={{ minHeight: '60vh' }}>
      <p className="eyebrow">404 · Severity: informational</p>
      <h1 className="h2" style={{ margin: '14px 0' }}>
        That page doesn’t exist.
      </h1>
      <p className="lede">Recommended action: go somewhere that does.</p>
      <p style={{ marginTop: 28 }}>
        <Link to="/" className="btn btn-primary">
          Back to the start
        </Link>
      </p>
    </main>
  );
}

function Page() {
  const { path } = useRouter();
  if (path === '/') return <Home />;
  if (path === '/avalanche') return <Avalanche />;
  const project = path.startsWith('/work/') ? projectBySlug(path.slice('/work/'.length)) : undefined;
  // `key` gives each case study fresh state (and replays its entrance) when moving between them.
  if (project) return <CaseStudy key={project.slug} project={project} />;
  return <NotFound />;
}

export function App() {
  return (
    <>
      <Nav />
      <Page />
    </>
  );
}
