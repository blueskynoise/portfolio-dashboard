# Privacy

This is an engineering description of what the site collects, not legal advice. Before going live, have someone qualified
confirm the lawful basis and notice for the jurisdictions you care about.

## What is collected

| Data | When | Purpose | Sent to | Stored |
| --- | --- | --- | --- | --- |
| IP address | Every evaluation | Access decision, rate limiting | ipapi.is, IPinfo, AbuseIPDB, Cloudflare (those configured) | Truncated (/24 or /48) and as a keyed hash. Never in full. |
| Request headers (User-Agent, Accept-Language, client hints, DNT/GPC) | Every evaluation | Access decision; shown to the visitor | Nobody | Browser family, major version and OS only. Not the full header. |
| A few script-read facts (secure context, cookies enabled, `navigator.webdriver`, feature detection) | Every evaluation | Access decision | Nobody | As part of the report. |
| Network enrichment (operator, organization, location, VPN/Tor/hosting flags, abuse score) | Every evaluation, for public addresses | Access decision; shown to the visitor | n/a | As part of the report; organization name and type as columns. |
| Session cookie | On ALLOW | Keeps the visitor admitted | Nobody | Server-side session row. |
| Browser fingerprint (canvas, WebGL, audio, fonts, GPU, screen, hardware, time zone, permissions states, referrer host) | **Only after the visitor opts in** | Show the visitor what fingerprinting reveals; recognize a returning browser | Nobody | Keyed hashes and the rendered report. |
| Recognition cookie (90 days) | **Only after the visitor opts in** | Link a later visit | Nobody | Keyed hash. |
| Page views (page address and title, referrer, browser details, IP address as seen by the vendor) | After admission, when `DREAMDATA_WRITE_KEY` is set and the visitor has not turned it off | Let the site owner see which companies visit | Dreamdata, directly from the browser | Not stored by this site. Held by Dreamdata under its own terms. |
| Dreamdata cookies and stored visitor id | **Only after the visitor allows it** | Link repeat visits in Dreamdata | Dreamdata | In the visitor's browser and at Dreamdata. |

Not collected: names, email addresses, precise location, anything behind a permission prompt, browsing history, any
cross-site identifier. No advertising is loaded. One third-party analytics tag (Dreamdata) is loaded when configured; with
no `DREAMDATA_WRITE_KEY` the site loads no third-party analytics at all and says so in its footer.

## Consent and notice

- The gate carries a notice, before and after evaluation, listing what is collected, why, the providers involved and the
  retention period. The provider list is generated from the live configuration, so it cannot drift.
- The security evaluation (address, headers, bot verification, enrichment) runs without a consent prompt, on the basis that
  it is necessary to protect the service. **This is the assumption to verify with counsel**, particularly the transfer of IP
  addresses to enrichment providers.
- Active fingerprinting and the recognition cookie are not necessary for the service, so they are opt-in. The API rejects a
  fingerprint submission without `consent: true`, and sets no cookie.
- Withdrawal: "Delete my fingerprint and the cookie" on the evaluation page calls `DELETE /api/me/fingerprint`.
- Dreamdata is disclosed in the notice on the gate, before admission, and is never loaded on the gate itself. After
  admission a visitor is asked once. With a yes it runs in full (cookies). With a no, nothing is loaded. Before an answer it
  runs in the vendor's cookieless mode if `DREAMDATA_COOKIELESS=on`, unless the browser sends Global Privacy Control or Do
  Not Track, in which case it does not run. The choice is kept in the browser's local storage and can be changed in the
  privacy notice on the evaluation page. **Cookieless-before-consent is the second assumption to verify with counsel**: it
  stores nothing on the device, but it still sends page views and the IP address to a third party for a purpose that is
  not security. Set `DREAMDATA_COOKIELESS=off` to make the tag strictly opt-in.

## Retention

`RETENTION_DAYS` (default 30). A job at boot and hourly deletes assessments older than that, and with them their provider
calls, sessions, fingerprints and investigations, plus old access events. The notice shows the same configured value.

## Access

- A visitor can see only the report their own session points to. No endpoint takes a report id.
- The administrator sees aggregates, a recent-evaluations table (truncated network, browser family, decision) and
  organization-level attribution. No full address is stored for anyone to see.
- Organization attribution names a network a connection came through. It is not an identity, and internet providers and
  hosting companies are excluded from the list.

## Provider terms to check

- **ipapi.is** licenses its data for internal use and prohibits redistribution. Showing a visitor the record for their own
  address is a small excerpt, but confirm this reading of their terms before relying on it.
- **AbuseIPDB**: the commercial-use terms of the free plan could not be confirmed during development. It is optional and
  off unless a key is set.
- **Cloudflare Turnstile**: loads a script from Cloudflare on the gate page. The widget is configured in **invisible mode**,
  and Cloudflare makes that conditional on referencing its
  [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/) in the site's own privacy notice. The
  reference is in the privacy notice (shown on the gate and on the evaluation page) and, when Turnstile is configured, in a
  line at the foot of the gate. Keep both if the notice is rewritten.

- **Dreamdata**: acts as a processor for the site owner. Confirm its data processing agreement is in place and that its
  description in the notice matches the plan in use (in particular that IP-to-company matching, not person-level
  identification, is what is enabled).

## Requests

Deletion or access requests: hello@markgraziano.com. Because addresses are stored only as keyed hashes, a record can be
found from an address the requester supplies, and deleted by assessment id.
