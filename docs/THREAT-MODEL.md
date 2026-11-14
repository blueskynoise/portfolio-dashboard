# Threat model

Scope: the access gateway and its data. The portfolio content itself is public and has no confidentiality requirement,
which shapes several choices below.

## Assets

| Asset | Why it matters |
| --- | --- |
| Visitor evaluation records | Personal data (network, browser, optionally a fingerprint). The main thing to protect. |
| Session and signing secrets | Forging a session, or correlating keyed hashes, needs these. |
| Provider credentials and quota | Abuse costs money or exhausts free tiers. |
| Admin access | Exposes aggregate and organization-level visitor data. |
| Integrity of decisions and analytics | A gateway whose records can be poisoned demonstrates nothing. |

## Trust boundaries

1. **Internet → Railway edge.** Everything from the client is untrusted, including every header.
2. **Edge → application.** The application trusts exactly one thing from the edge: the header named by `CLIENT_IP_SOURCE`.
3. **Application → providers.** Responses are untrusted input: parsed defensively, never executed, treated as evidence.
4. **Application → Postgres.** Trusted; parameterized queries only.
5. **Browser script → application.** Client evidence and fingerprints are claims. They are size-limited, type-checked,
   labeled as claims in the report, and never used alone to grant anything.

## Threats and what is done about them

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Spoofed client address via `X-Forwarded-For` | The address source is a deployment setting. In production only `X-Real-IP` from the edge is read. Tested. | If the platform stopped overwriting that header, spoofing would work. The deployment guide includes a check. |
| Requesting protected files directly | Every non-gate file needs a valid session; the file index is built at boot so no user input reaches the filesystem. Tested, including traversal. | None known. |
| Session forgery or tampering | HMAC-SHA256 over the payload, constant-time comparison, signature checked before the body is read. | Compromise of `SESSION_SECRET`. Rotating it invalidates all sessions. |
| Session replay from another client | Sessions are bound to a hash of the issuing User-Agent and expire; server-side rows allow revocation. | An attacker who copies both the cookie and the User-Agent can replay until expiry. Acceptable for a public site. |
| Cross-site request forgery | `SameSite=Lax` cookies (admin: `Strict`), and state-changing requests with a foreign `Origin` are rejected. | Non-browser clients send no Origin; they also carry no victim cookies. |
| Forged client evidence | Compared with the request headers; a mismatch without bot verification triggers a challenge. All script-reported values are labeled as claims. | A careful forger passes. That is why nothing is granted on client evidence alone. |
| Automation and scraping | Turnstile, validated server-side with action and hostname checks. | Paid solving services defeat any CAPTCHA. The gate raises cost; it does not stop a determined scraper. |
| Flooding to burn provider quota | Per-address assessment limit (over it: DENY without calling providers), response caching, a hard per-provider daily budget, a global API rate limit. | Distributed sources can still spend the daily budget, after which signals degrade to "unknown" rather than costing more. |
| Admin brute force | scrypt hash, five attempts per address per 15 minutes, constant-time verify, events logged. | A weak password. Use a long random one. |
| Provider outage or slow response | Deadlines on every call; parallel enrichment; fail open with reduced assurance. | During an outage the gate is weaker, visibly. |
| Provider returns garbage or a false success | Shape checks on every response; an unparseable 200 is a failure; the Tor list is rejected if implausibly small. | A provider returning well-formed wrong data. Signals are labeled as third-party evidence. |
| Poisoned analytics | Analytics read only server-written rows. Client-supplied strings are bounded and rendered as text. | Organization names come from a provider and are shown to the admin as inferences. |
| Cross-visitor disclosure | A visitor's report is addressed only through their own session; there is no report id in any URL. Tested. | None known. |
| XSS | React escaping, no `dangerouslySetInnerHTML`, strict CSP (`default-src 'none'`, scripts from self only; the gate additionally allows Turnstile). | `style-src 'unsafe-inline'` is allowed for inline styles. |
| Secrets in logs | Tokens are sent in headers or bodies, never URLs; logs redact cookies and omit addresses. | Provider-side logging is outside our control. |
| Fingerprinting library phoning home | Configured with no API key, logging off, beacon off; `connect-src 'self'` blocks it regardless. | A future library version could change behavior; the CSP is the backstop. |

## Privacy threats

- **Function creep.** The data could be used to profile visitors. Mitigations: truncated addresses, keyed hashes, 30-day
  retention enforced by a job, organization-level attribution only, no third-party tracking tags.
- **Re-identification through fingerprints.** Stored only with consent, keyed with a server secret so they are useless
  outside this database, deletable by the visitor.
- **Over-claiming.** The system could present inferences as facts. Mitigations: every signal carries its kind (observed,
  self-reported, classification, inference, unknown) and a limitation; recognition states its confidence.

## Out of scope

- Denial of service at the network layer (left to the platform).
- A compromised hosting platform or database.
- Device posture. A public website cannot measure it, and the gateway does not pretend to.
- Protecting the portfolio's content. It is public by intent.
