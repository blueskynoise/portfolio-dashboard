# Architecture

One Node process serves everything: the API, the gate, and (to requests with a session) the portfolio. One Postgres
database stores evaluations. There is no queue, cache server or separate worker, because nothing here needs one.

## Request flow

```
Browser                         Railway edge                 apps/api (Fastify)                    Providers / Postgres
   │  GET /                          │                               │
   ├────────────────────────────────►│  adds X-Real-IP, X-Forwarded-Proto
   │                                 ├──────────────────────────────►│ no valid session cookie
   │◄──────────────── gate.html + CSP allowing Turnstile ────────────┤ (the portfolio bundle is NOT sent)
   │
   │  gate script: read a few browser facts, obtain a Turnstile token
   │  POST /api/assessments {client, botToken}
   ├────────────────────────────────────────────────────────────────►│ 1 resolve client IP from the configured source only
   │                                                                 │ 2 first-party counters (rate, failed challenges)
   │                                                                 │ 3 enrich in parallel ───────────► ipapi.is, IPinfo, AbuseIPDB
   │                                                                 │   (timeout, cache, daily budget)   Tor list (in memory)
   │                                                                 │ 4 validate token ───────────────► Cloudflare siteverify
   │                                                                 │ 5 build signals + policy facts
   │                                                                 │ 6 evaluatePolicy(facts) -> decision, reasons
   │                                                                 │ 7 INSERT assessment + provider calls ──► Postgres
   │                                                                 │ 8 on ALLOW: INSERT session, Set-Cookie (HttpOnly, signed)
   │◄──────────────── report (full IP shown live, never stored) ─────┤
   │
   │  GET /   (now with cookie)
   ├────────────────────────────────────────────────────────────────►│ verify signature, expiry, revocation, issuing browser
   │◄──────────────── index.html + strict CSP ───────────────────────┤
   │  GET /static/app-*.js, /assets/*  -> 401 without a session
   │
   │  optional, after explicit consent:
   │  POST /api/me/fingerprint {consent: true, fingerprint}
   ├────────────────────────────────────────────────────────────────►│ sanitise, key the hashes, correlate with earlier visits
   │◄──────────────── signals, inconsistencies, recognition ─────────┤ store; set 90-day recognition cookie
```

## Components

| Path | Responsibility |
| --- | --- |
| `packages/policy` | `evaluatePolicy(facts)`: pure, deterministic, versioned. No clock, network or randomness. |
| `apps/api/src/clientIp.ts` | Which address to believe. One configured source; never a best-effort guess across headers. |
| `apps/api/src/http.ts` | Outbound calls with a deadline, one bounded retry, and outcomes that distinguish timeout / error / unparseable. |
| `apps/api/src/providers/*` | One adapter per provider. Each has a cache, a daily budget, and reports `unconfigured` without credentials. |
| `apps/api/src/evidence.ts` | Builds every signal with its provenance, and the policy facts from the same data. |
| `apps/api/src/assess.ts` | Orchestrates one evaluation and measures each stage. |
| `apps/api/src/sessions.ts` | HMAC-signed session tokens. |
| `apps/api/src/static.ts` | Splits the web build into public (gate) and protected (everything else) using Vite's manifest. |
| `apps/api/src/correlation.ts` | Links a visit to earlier ones and states how confident it is. |
| `apps/api/src/admin/metrics.ts` | Operational analytics as pure functions over stored rows. |
| `apps/api/src/store/*` | `Store` interface; Postgres for real use, in-memory for tests and database-less local runs. |
| `packages/analytics` | The synthetic company: generator, pipeline, metrics, narrative. No dependency on the gateway. |

## Decisions worth knowing

**The gate is enforced by the server, not the page.** The web build has two entry points. Vite's manifest lists which
files the gate depends on; the API serves those to anyone and refuses every other file without a session. A page
navigation returns one of two HTML documents depending on the session. Hiding content with a React overlay would not be
access control.

**No decision takes effect until it is recorded.** The assessment row is written before the session cookie is issued. If
the write fails the visitor gets a 503 and can retry; nobody is admitted on an unrecorded decision.

**Fail open, and say so.** This is a public portfolio, so a provider outage must not lock people out. When evidence is
missing the decision is ALLOW with `assurance: reduced` and a reason code naming what was missing. Rules whose facts are
unknown are reported as "not evaluable", never as passed. Deny rules use only first-party counters, so they keep working
when every provider is down.

**No numeric risk score.** Each rule is a readable condition with a rationale. A score would look more sophisticated and
explain less.

**Data minimisation in the schema.** The full IP address and full User-Agent are never stored: only a keyed hash (for
counting and rate limits) and a truncated prefix. The visitor sees the full values in the live response, and again later
only if the request comes from the same address.

**Fingerprinting is a separate, opt-in step.** The access decision does not depend on it. It runs after admission, only
with `consent: true`, and can be deleted by the visitor.

**Single instance.** Rate-limit counters and provider caches live in process memory. Running more than one replica would
give each its own quota; the counters would need to move to Postgres or Redis first.

## Data model

`db/migrations/001_init.sql`:

- `assessments`: one row per evaluation. Decision, assurance, reason codes, the redacted report, summary columns for analytics.
- `provider_calls`: one row per provider per evaluation. Status, latency, data age.
- `sessions`: server-side session rows, for expiry and revocation.
- `fingerprints`: opt-in only. Keyed hashes, recognition result.
- `access_events`: rate limits, rejected sessions, failed challenges, admin logins.
- `investigations`: decisions an administrator flagged as possible false positives.
- `policy_versions`: every policy version that has run.

Everything hangs off `assessments` with `ON DELETE CASCADE`, so retention is one delete.

## Observability

- Structured JSON logs (pino). One `assessment` line per evaluation with decision, assurance, reason codes, duration and
  each provider's status. Logs never contain addresses, cookies or query strings.
- `x-request-id` on every response, reusing Railway's request id when present, and stored with each assessment.
- `/healthz` (liveness) and `/readyz` (database reachable, provider configuration, Tor list loaded).
- The admin page reports provider failure rates, latency percentiles, signal availability, stale-data decisions, and an
  invariant that must stay at zero: provider failures recorded as full-assurance decisions.
