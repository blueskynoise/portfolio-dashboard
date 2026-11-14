import { lazy, Suspense, useEffect } from 'react';
import { AnalyticsConsent } from './components/AnalyticsConsent';
import { Nav } from './components/Chrome';
import { projectBySlug } from './content/projects';
import { startAnalytics, trackPage } from './lib/analytics';
import { useDocumentTitle } from './lib/hooks';
import { Link, useRouter } from './lib/router';
import { CaseStudy } from './pages/CaseStudy';
import { Home } from './pages/Home';

/**
 * The heavier pages load on demand. After a new deploy, a tab that was already open asks for a chunk that no
 * longer exists; reloading once picks up the new build instead of leaving a blank page.
 */
function page<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      if (!sessionStorage.getItem('reloaded-for-chunk')) {
        sessionStorage.setItem('reloaded-for-chunk', '1');
        window.location.reload();
      }
      throw error;
    });
}
const Program = lazy(page(() => import('./pages/Program').then((m) => ({ default: m.Program }))));
const Access = lazy(page(() => import('./pages/Access').then((m) => ({ default: m.Access }))));
const Admin = lazy(page(() => import('./pages/Admin').then((m) => ({ default: m.Admin }))));

function NotFound() {
  useDocumentTitle('Not found — Mark Graziano');
  return (
    <main id="main" tabIndex={-1} className="wrap section" style={{ minHeight: '60vh' }}>
      <p className="eyebrow">404</p>
      <h1 className="h2" style={{ margin: '14px 0' }}>
        That page doesn’t exist.
      </h1>
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
  if (path === '/program') return <Program />;
  if (path === '/access') return <Access />;
  if (path === '/admin') return <Admin />;
  const project = path.startsWith('/work/') ? projectBySlug(path.slice('/work/'.length)) : undefined;
  if (project) return <CaseStudy key={project.slug} project={project} />;
  return <NotFound />;
}

export function App() {
  const { path } = useRouter();
  useEffect(() => startAnalytics(), []);
  // One page view per route. The first is sent by the loader itself once it knows whether it may run.
  useEffect(() => {
    const timer = window.setTimeout(trackPage, 0);
    return () => window.clearTimeout(timer);
  }, [path]);
  return (
    <>
      <Nav />
      <Suspense fallback={<main id="main" className="wrap section" aria-busy="true" style={{ minHeight: '60vh' }} />}>
        <Page />
      </Suspense>
      <AnalyticsConsent />
    </>
  );
}
