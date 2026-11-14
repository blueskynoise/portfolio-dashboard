# portfolio-dashboard

Mark Graziano's portfolio. It is also three working systems:

1. **A live access gateway.** Every visit is evaluated before the site loads: the connection is enriched from real
   providers, a versioned policy decides ALLOW / CHALLENGE / DENY, and the server issues a session. The visitor is then shown
   everything that was learned about their own connection, with provenance for each signal.
2. **A security-program case study.** An interactive investigation of a synthetic company's vulnerability backlog, built on
   a real pipeline (normalize, deduplicate, correlate, attach ownership) and a narrative engine that separates what was
   computed from what is only suspected.
3. **Operational analytics for the gateway itself**, behind an admin login, answering "is the evaluation doing its job?"

```
apps/
  api/        Fastify server: gateway, provider adapters, sessions, Postgres store, admin analytics
  web/        Vite + React: the gate (public) and the portfolio (served only with a session)
packages/
  contracts/  Types shared by API and web
  policy/     The access policy: a pure, versioned function with reason codes
  analytics/  Synthetic enterprise: generator, pipeline, metrics, narrative
db/migrations/  Forward-only SQL
docs/           Architecture, threat model, privacy, providers, deployment, checklist
```

## Run it locally

Requires Node 22+ and Docker (for Postgres). Use npm 11 or newer to change dependencies; `npm ci` works on older versions.

```bash
npm ci
cp .env.example .env          # every provider key is optional
npm run db:up                 # Postgres on localhost:54329
npm run build
npm run db:migrate            # reads DATABASE_URL from the environment
npm start                     # http://localhost:8787  (node --env-file=.env apps/api/dist/server.js to load .env)
```

`npm start` serves the built site exactly as production does, with the gate enforced by the server.
For UI work with hot reload, run `npm run dev` (API on 8787, Vite on 5173). In that mode the Vite server hands out every
file, so the gate is only a redirect; enforcement is the API server's job.

With no provider keys, the gateway still runs: every signal a provider would supply is reported as *not configured* and
decisions are recorded as reduced assurance. Nothing is simulated to fill the gap.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # 140+ tests; store tests are skipped without a database
npm run test:db     # store tests against a real Postgres (creates and wipes portfolio_test)
npm run build
```

## Configuration

See `.env.example`. In production the server refuses to start without `SESSION_SECRET` (32+ characters) and
`DATABASE_URL`, and lists every problem at once.

| Provider | What it adds | Cost | Variable |
| --- | --- | --- | --- |
| Cloudflare Turnstile | Server-validated bot verification | Free | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| ipapi.is | Organization, network type, coarse location, VPN/proxy/datacenter flags | Free, 1,000/day | `IPAPI_IS_KEY` |
| IPinfo Lite | Second opinion on network operator and country | Free, unlimited | `IPINFO_TOKEN` |
| Tor Project exit list | Tor exit membership | Free, no key | none |
| AbuseIPDB | Abuse reports about an address | Free, 1,000/day | `ABUSEIPDB_API_KEY` |

Details, limits and what was ruled out: [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md): how a request moves through the system
- [Threat model](docs/THREAT-MODEL.md): trust boundaries, spoofing, abuse, what is out of scope
- [Privacy](docs/PRIVACY.md): what is collected, on what basis, and for how long
- [Providers](docs/PROVIDERS.md): what was evaluated, chosen and rejected
- [Deploying to Railway](docs/DEPLOY-RAILWAY.md)
- [Implementation checklist](docs/CHECKLIST.md): what is done, and what has only been tested locally

## Honesty notes

- The case-study company is synthetic. No record comes from any employer. It is unrelated to the live visitor data.
- A public website cannot measure device posture (disk encryption, patching, EDR, management). The gateway says so in every
  report rather than implying otherwise.
- A browser fingerprint identifies a browser configuration, not a person. Recognition results state their confidence and
  what argues against them.
- This is a public portfolio. Nothing confidential is behind the gate; it demonstrates the pattern, and is enforced for real.
