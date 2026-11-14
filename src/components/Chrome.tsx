import { profile } from '../content/site';
import { Ext, Link, useRouter } from '../lib/router';

export function Nav() {
  const { path } = useRouter();
  return (
    <header className="nav">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="wrap nav-inner" aria-label="Primary">
        <Link to="/" className="nav-name" aria-label={`${profile.name}, home`}>
          <span className="nav-mark" aria-hidden="true">
            MG
          </span>
          <span>{profile.name}</span>
        </Link>
        <div className="nav-links">
          <Link to="/#work" aria-current={path.startsWith('/work') ? 'page' : undefined}>
            Work
          </Link>
          <Link to="/avalanche" aria-current={path === '/avalanche' ? 'page' : undefined}>
            Avalanche
          </Link>
          <Link to="/#background">Background</Link>
          <Link to="/#contact">Contact</Link>
        </div>
      </nav>
    </header>
  );
}

export function Contact() {
  return (
    <footer className="contact" id="contact" tabIndex={-1}>
      <div className="wrap">
        <p className="eyebrow">Contact</p>
        <h2 className="display">
          Have a process that hurts? <em className="mark">Tell me about it.</em>
        </h2>
        <div className="contact-links">
          <a className="btn btn-primary" href={`mailto:${profile.email}`}>
            {profile.email}
          </a>
          <Ext className="btn btn-ghost" href={profile.github}>
            GitHub <span aria-hidden="true">↗</span>
          </Ext>
        </div>
        <div className="fineprint">
          <span>© {profile.name}</span>
          <span>No analytics, no cookies, no third-party requests. The only alerts here are synthetic.</span>
        </div>
      </div>
    </footer>
  );
}
