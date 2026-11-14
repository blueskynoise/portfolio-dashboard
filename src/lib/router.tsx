import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * A very small client-side router. The site has five routes; a routing
 * library would be more code than the thing it routes.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface Location {
  path: string;
  hash: string;
}

function readLocation(): Location {
  let path = window.location.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  path = path.replace(/\/index\.html$/, '/').replace(/(.)\/$/, '$1') || '/';
  return { path, hash: window.location.hash };
}

interface RouterValue extends Location {
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export const href = (to: string): string => `${BASE}${to}`;

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', href(to));
    setLocation(readLocation());
  }, []);

  // After a navigation: go to the hash target if there is one, otherwise
  // to the top, and move keyboard focus to the page so screen readers
  // announce the new content.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = requestAnimationFrame(() => {
      const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
      if (target) {
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      } else {
        window.scrollTo(0, 0);
        document.getElementById('main')?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [location.path, location.hash]);

  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter outside <Router>');
  return value;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={href(to)} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** External link with safe defaults. */
export function Ext({ children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

export const asset = (file: string): string => `${import.meta.env.BASE_URL}assets/${file}`;
