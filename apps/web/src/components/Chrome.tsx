import { profile } from '../content/site';
import { useAnalytics } from '../lib/analytics';
import { Ext, Link, useRouter } from '../lib/router';

export function Nav() {
  const { path } = useRouter();
  const current = (match: boolean) => (match ? ('page' as const) : undefined);
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
          <Link to="/program" aria-current={current(path === '/program')}>
            Case study
          </Link>
          <Link to="/#experience">Experience</Link>
          <Link to="/#projects" aria-current={current(path.startsWith('/work'))}>
            Projects
          </Link>
          <Link to="/access" aria-current={current(path === '/access')} className="nav-access">
            Your evaluation
          </Link>
        </div>
      </nav>
    </header>
  );
}

const ANALYTICS_LINE = {
  full: 'One third-party tag: company-level visit analytics by Dreamdata, with cookies, because you allowed it.',
  cookieless: 'One third-party tag: company-level visit analytics by Dreamdata, running without cookies.',
  off: 'Company-level visit analytics by Dreamdata is off for you.',
} as const;

export function Contact() {
  const analytics = useAnalytics();
  return (
    <footer className="contact" id="contact" tabIndex={-1}>
      <div className="wrap">
        <p className="eyebrow">Contact</p>
        <h2 className="display">
          Have security data that isn’t telling you anything yet? <em className="mark">Let’s talk.</em>
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
          <span>
            {analytics.configured ? `No advertising. ${ANALYTICS_LINE[analytics.mode]}` : 'No advertising, no analytics service, no third-party trackers.'}{' '}
            <Link to="/access#privacy">See what this site knows about your visit{analytics.configured ? ', and change this' : ''}.</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
