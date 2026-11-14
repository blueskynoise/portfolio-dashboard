# portfolio-dashboard

Mark Graziano's portfolio: three product case studies, a professional narrative, and an
interactive security-engineering simulation.

Content is migrated from the existing personal site (`personal-site`, markgraziano.com).
Nothing factual was added that the original site does not already say.

## What's here

| Route | What it is |
| --- | --- |
| `/` | Home: intro, "The World's Most Reasonable SOC", featured work, background, principles |
| `/work/bivvi`, `/work/txr-studio`, `/work/summa` | Case studies, each with a small interactive sketch of the product's core idea |
| `/avalanche` | The Great Alert Avalanche: "10,000 alerts. How many actually matter?" |

## Stack

Vite, React 19, TypeScript (strict), Vitest. Plain CSS with custom properties. No UI
framework, router library, analytics, cookies or third-party requests; fonts are
self-hosted via `@fontsource`.

```
npm install        # see note below
npm run dev        # http://localhost:5173
npm test           # simulation tests
npm run lint
npm run typecheck
npm run build      # type-check, bundle, write per-route entry points into dist/
npm run preview    # serve the production build
```

> npm 10.9 fails to resolve this dependency tree (`Cannot read properties of null
> (reading 'edgesOut')`) when re-resolving. `npm ci` against the committed lockfile works; to
> change dependencies use npm 11+ (`npx npm@latest install`).

To serve from a sub-path (for example GitHub Pages without a custom domain):
`BASE_PATH=/portfolio-dashboard/ npm run build`.

## Layout

```
src/
  sim/          the simulation engine: pure TypeScript, no React, fully tested
  content/      all site copy and project data
  pages/        Home, CaseStudy, Avalanche
  components/   SOC console, project previews, Avalanche views
  lib/          ~100-line router, hooks
  styles/       design tokens and CSS
scripts/postbuild.mjs   copies index.html to each route + 404.html for static hosts
```

## The simulation

`runSimulation(config, policy)` in `src/sim/pipeline.ts` is a pure function. Given a seed,
an alert count and a set of fault switches, it generates a synthetic world with a known
ground truth, has three fictional scanners report on it for five scans, and runs the
records through seven stages:

ingest → normalize → deduplicate → identity & state → reconcile → risk context → prioritize

The UI only replays the reports that function returns. No number on screen is produced by
animation code.

The three sources model three delivery styles:

- **harbor**: full snapshot scans pulled page by page. Absence is its only "fixed" signal.
- **lantern**: incremental change feed read from a cursor, with explicit revisions.
- **sieve**: pushed events, delivered at least once and in any order.

Faults a visitor can switch on: HTTP 429s, duplicate deliveries, updates missing from the
change feed, out-of-order events, a page that permanently fails, and findings that vanish
from a scan without being fixed.

### What the tests assert

Across all 64 combinations of faults and several seeds (`src/sim/pipeline.test.ts`):

- **Safety**: no finding that still exists is ever marked resolved.
- **Liveness**: once the faults stop, state converges to exactly the ground truth.
- **Stability**: the recommended work list is identical to a clean run's.

The same engine run with a deliberately naive policy (missing means fixed, arrival order
wins, no reconciliation) fails those properties under the same faults. That comparison is
in the tests and on the page, so the safety tests are known to be able to fail.

### What it is not

Everything is synthetic: no real scanners, vendors, CVEs or organisations (identifiers
use a `SYN-` prefix). It runs entirely in the browser and protects nothing. "Missing from
two complete scans" is a policy choice, not a proof of remediation.

## Security defaults

- Production builds inject a Content-Security-Policy (`default-src 'none'`,
  `connect-src 'none'`, scripts and fonts from `'self'` only). See `vite.config.ts`.
- External links use `rel="noopener noreferrer"`.
- The SOC console is scripted. It reads nothing about the visitor or their browser.

## Deployment

Not configured. `npm run build` produces a static `dist/` suitable for any static host.
The original site's `CNAME` (markgraziano.com) has deliberately not been copied here.
