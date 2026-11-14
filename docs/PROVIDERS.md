# Providers: what was evaluated

Checked in November 2026. Pricing and terms change; re-verify before relying on any figure here.

## Chosen

### Cloudflare Turnstile — bot verification
- Free plan: unlimited verifications, up to 20 widgets, 10 hostnames per widget.
- Tokens are validated server-side at `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`. Valid for 300 seconds,
  intended for one validation. The adapter sends an idempotency key so its single retry is safe, and checks the returned
  `action` and (optionally) `hostname`.
- Outcomes are kept apart: the visitor failing, the provider being unreachable, and our secret being wrong are three
  different things and only the first counts against anyone.

### ipapi.is — organization, network type, location, anonymizer flags
- Free: 1,000 requests a day with a registered key; their terms say commercial use is included.
- Returns the organization in the WHOIS record for the range, a network type (isp, hosting, business, education,
  government, banking), coarse location with an accuracy rating, and `is_datacenter`, `is_vpn`, `is_proxy`, `is_tor`,
  `is_mobile`, `is_abuser`.
- Their own caveats, which the UI repeats: the data is probabilistic; "company" is the most specific WHOIS record and can
  name a customer rather than the host; residential and mobile proxies are mostly not detected.
- Terms restrict the data to internal use and prohibit redistribution. See the note in `PRIVACY.md`.
- The adapter POSTs the key in the body so it never appears in a URL, caches answers for six hours, and stops at the
  daily budget.

### IPinfo Lite — second opinion on network and country
- Free, no stated request limit, token required. Returns ASN, AS name, AS domain and country. No city, no privacy flags.
- Used to corroborate ipapi.is: when both answer, the report says whether they agree. The paid Core plan ($49/month)
  adds privacy flags and an AS type; the adapter reads those if `IPINFO_PLAN=core`.

### Tor Project bulk exit list — Tor exit membership
- Public, free, no key. Downloaded hourly and held in memory; the visitor's address is not sent anywhere.
- The loader rejects a list with fewer than 100 entries (the real one has over a thousand), keeps the previous good list
  on failure, and reports the list's age with every answer.

### AbuseIPDB — address reputation (optional)
- Free: 1,000 checks a day. Returns an abuse confidence score from community reports.
- Used only as a trigger for bot verification, never to deny. Cached for six hours.
- Commercial-use terms for the free plan could not be confirmed. Off unless `ABUSEIPDB_API_KEY` is set.

## Investigated and not integrated

### Leadfeeder (formerly Dealfront)
A tracking tag that feeds their dashboard with the companies visiting a site. Third-party sources put the free plan at
about 100 identified companies a month with seven days of history. Whether the free plan includes API access could not
be confirmed from their own pages. Without an API there is no way to put its attribution into a visitor's report, and
adding the tag would mean loading a third-party tracker, which this site otherwise avoids. **If you want its dashboard for
your own lead tracking, it can be added as a consent-gated tag; it was left out by default.**

### RB2B
Markets person-level identification of website visitors by matching against data gathered elsewhere. Its own plan
comparison lists webhooks as a paid (Pro) feature, and reports indicate the free plan became company-level only in
January 2026. **Not recommended here regardless of plan:** it identifies individuals who have not been asked, which is the
opposite of what this gateway is built to demonstrate, and its lawful use outside the US is doubtful.

### IPinfo company data
Available only on higher paid tiers; sources disagreed on which. ipapi.is supplies the equivalent for free.

### People Data Labs IP enrichment
Has a real API, but the free allowance is a few dozen IP lookups a month. Too small for production.

## What "organization" means in this system

It is the organization that registered the address range, according to one provider. For a home connection that is the
ISP; for a VPN it is the VPN's host; for an office it is, at best, whoever registered the block. The report labels it an
inference with low or medium reliability, and the admin list excludes ISPs and hosting companies. It can tell you that
*a connection came through a named organization's network*. It cannot tell you who was at the keyboard, or that they
work there.

## Sources

- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/plans/
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://ipapi.is/developers.html and https://ipapi.is/terms.html
- https://ipinfo.io/developers/lite-api and https://ipinfo.io/developers/core-api
- https://docs.abuseipdb.com/ and https://www.abuseipdb.com/pricing
- https://check.torproject.org/torbulkexitlist
- https://support.rb2b.com/en/articles/9173659-rb2b-plans-side-by-side-comparisons
- https://www.leadfeeder.com/product-updates/dealfront-is-rebranding-as-leadfeeder-faq/
- https://docs.railway.com/networking/public-networking/specs-and-limits
