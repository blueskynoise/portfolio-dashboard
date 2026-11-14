# Implementation checklist

Status as of the last commit on `feature/portfolio-redesign`. "Verified" says how.

## Access gateway

| Item | Status | Verified |
| --- | --- | --- |
| Versioned, deterministic policy with reason codes | Done | Unit tests |
| ALLOW / CHALLENGE / DENY, ALLOW as the normal outcome | Done | Unit + HTTP tests |
| VPN, Tor, privacy browsers not penalized | Done | Tests |
| Unknown never treated as clean | Done | Tests, and an admin invariant |
| Server-enforced gate (protected bundle and assets) | Done | HTTP tests; curl against the production build |
| Signed, HTTP-only sessions; expiry; revocation; bound to issuing browser | Done | HTTP tests; curl |
| Forged forwarding headers ignored | Done | Tests; curl locally; and on Railway: a forged `X-Real-IP` and `X-Forwarded-For` were both ignored |
| Rate limiting (per-address evaluations, global API, admin login) | Done | HTTP tests |
| Provider timeouts, retries, caching, daily budgets | Done | Tests with scripted providers |
| Fail-open with reduced assurance when a provider is down | Done | HTTP tests |
| Postgres persistence and migrations | Done | Integration tests against Postgres 17 |
| Retention job | Done | Tests (memory and Postgres) |
| Request correlation ids, structured logs without addresses | Done | Seen in local logs |
| Turnstile integration | Built | **Adapter tested with scripted responses only. No real key was available.** |
| ipapi.is, IPinfo, AbuseIPDB integrations | Built | **Adapters tested with scripted responses only. No real keys were available.** |
| Tor exit list | Done | Tests, and the live list loaded locally (1,259 exits) |

## Visitor intelligence

| Item | Status | Verified |
| --- | --- | --- |
| Per-signal source, method, kind, reliability, limitation | Done | In the browser |
| Passive reveal without consent prompt | Done | In the browser (loopback only, so enrichment showed as unknown) |
| Opt-in fingerprint (ThumbmarkJS + first-party collectors) | Done | In Chrome on macOS: real GPU, canvas, WebGL, audio values |
| Recognition with stated confidence | Done | Tests; the cookie path seen in Chrome ("recognized", high confidence). The no-cookie paths are covered by tests only |
| Script-versus-connection inconsistencies | Done | Tests |
| Consent required server-side; deletion endpoint | Done | HTTP tests |
| Other browsers (Firefox, Safari, Brave, mobile) | **Not tested** | Collectors are defensive, but behavior was only observed in Chrome |

## Program case study

| Item | Status | Verified |
| --- | --- | --- |
| Internally consistent synthetic dataset | Done | Tests: every record accounted for, flows balance in every view |
| Real pipeline (normalize, dedupe, correlate, ownership) | Done | Tests |
| Metrics with stated denominators and stable cohorts | Done | Tests |
| Narrative tagged computed / explanation / hypothesis / caveat | Done | Tests, including that the conclusion changes when the data does |
| Interactive filters recompute everything | Done | In the browser |
| Drill-down to source records | Done | In the browser |
| Engineering view | Done | In the browser |

## Portfolio

| Item | Status |
| --- | --- |
| New positioning and hero | Done |
| Experience narrative (GRC to automation engineering) | Done, from the owner's own statements. No employers, dates or metrics. **Needs the owner's review for accuracy.** |
| Four projects together, podcast included | Done |
| Old philosophy sections (lenses, principles, On AI) | Removed from the page; still in git history |

## Operations

| Item | Status |
| --- | --- |
| Admin analytics behind authentication | Done; tested |
| Architecture, threat model, privacy, provider and deployment docs | Done |
| CI workflow | Written. **Never run** (the branch has not been pushed) |
| Railway deployment | Deployed to a Railway-generated URL with Postgres. Health, gate enforcement, session cookie and header-spoofing checks passed with curl, and the gate-to-portfolio flow was checked in Chrome. Deploys automatically from the connected GitHub branch. **No provider keys set yet and no custom domain** |
| Mobile layout of the new pages | **Checked at 606px only** (no horizontal overflow). Not checked at phone widths or on a device |
| Accessibility | Keyboard-operable controls, labeled regions, reduced-motion CSS. **No screen-reader testing** |
| Legal review of notice and consent | **Not done.** See PRIVACY.md |
