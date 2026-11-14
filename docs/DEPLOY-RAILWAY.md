# Deploying to Railway

These steps reflect an actual deployment of this repository to Railway. Work through the verification list at the end
after any change to the proxy, domain or provider configuration.

## 1. Create the project

Railway no longer reads `railway.json` for new services (Config as Code was retired for them, and stops working for
existing ones on 2026-12-01), so the settings live on the service itself.

1. Create a project with a PostgreSQL database and one service, `web`, deployed from this repository.
2. On the `web` service, set:

   | Setting | Value |
   | --- | --- |
   | Build command | `npm run build` (type-check, web build, API bundle) |
   | Pre-deploy command | `npm run db:migrate` |
   | Start command | `npm start` |
   | Healthcheck path | `/readyz` (fails while the database is unreachable, so a bad deploy does not take traffic) |
   | Healthcheck timeout | 60 seconds |
   | Restart policy | On failure, 5 retries |

   Without the pre-deploy command the server starts against an empty database and exits with
   `relation "policy_versions" does not exist`.
3. Keep the service at **one replica**. Rate-limit counters and provider caches are in process memory.

## 2. Variables

Set these on the web service.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | 48+ random characters: `openssl rand -base64 48` |
| `IP_HASH_SECRET` | A second, different random value |
| `CLIENT_IP_SOURCE` | `x-real-ip` (the production default) |
| `PUBLIC_ORIGIN` | `https://markgraziano.com` (your final origin, no trailing slash) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | From the Cloudflare dashboard; add your domain to the widget's hostnames |
| `TURNSTILE_HOSTNAME` | Your domain, to reject tokens minted for another site |
| `IPAPI_IS_KEY` | From ipapi.is |
| `IPINFO_TOKEN` | From ipinfo.io (Lite) |
| `ABUSEIPDB_API_KEY` | Optional |
| `DREAMDATA_WRITE_KEY` | Optional. The write key from Dreamdata's install snippet. Enables company-level visit analytics. |
| `DREAMDATA_COOKIELESS` | `on` (default) or `off`. `off` means nothing runs until a visitor allows it. See `docs/PRIVACY.md`. |
| `ADMIN_PASSWORD_HASH` | See below. Omit to disable the admin interface. |

The server refuses to start in production without `SESSION_SECRET` and `DATABASE_URL`, and prints every problem.

### Admin password

Run locally, after `npm run build`:

```bash
npm run admin:hash      # type a long password at the prompt; it prints ADMIN_PASSWORD_HASH=scrypt:...
```

Put only the hash in Railway. The format uses colons, so it is safe in environment files.

## 3. Domain

Add the custom domain in Railway and point DNS at it. The session cookies use the `__Host-` prefix in production, which
requires HTTPS; Railway terminates TLS at its edge.

If you put Cloudflare's proxy in front of Railway, there are then two proxies. Set `CLIENT_IP_SOURCE=x-forwarded-for` and
`TRUSTED_PROXY_HOPS=2`, and re-run the address check below.

## 4. Verify the deployment

Do not treat the site as live until these pass.

1. **Health.** `curl https://YOUR_DOMAIN/readyz` shows `store: postgres`, each provider `configured`, and Tor exits loaded.
2. **The gate is enforced.**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/assets/bivvi-logo.png     # expect 401
   curl -s https://YOUR_DOMAIN/ | grep -o "<title>[^<]*"                                   # expect the access evaluation title
   ```
3. **The client address cannot be spoofed.** This is the one assumption that could not be tested off-platform.
   ```bash
   curl -s -X POST https://YOUR_DOMAIN/api/assessments -H 'content-type: application/json' \
     -H 'X-Real-IP: 8.8.8.8' -H 'X-Forwarded-For: 8.8.8.8' -d '{}' | grep -o '"network.ip"[^}]*'
   ```
   The address reported must be your real one, not `8.8.8.8`. If it is `8.8.8.8`, the edge is passing client headers
   through: stop, and switch to `x-forwarded-for` with the correct hop count.
4. **In a browser.** Load the site, confirm the report shows your real network and location, that Turnstile validated
   (bot verification "passed", assurance "standard"), enter the portfolio, and open "Your evaluation".
5. **Fingerprint opt-in.** Opt in, reload in a private window and opt in again: the second visit should say "probably
   returning" (same fingerprint, same network, no cookie).
6. **Admin.** Sign in at `/admin`. "Failures counted as passes" must be 0.
7. **Logs.** Confirm one `assessment` line per evaluation and no addresses or cookies in the output.

## Operating notes

- **Staging.** Create a second Railway environment with its own database and its own Turnstile widget. Set `RETENTION_DAYS`
  low there.
- **Migrations** are forward-only files in `db/migrations`, applied in name order under an advisory lock.
- **Rotating `SESSION_SECRET`** signs everyone out. Rotating `IP_HASH_SECRET` breaks the link between old and new
  fingerprints and rate-limit history, which is sometimes what you want.
- **Provider budgets.** `PROVIDER_DAILY_LIMIT` (default 900) caps live calls per provider per UTC day, per process. When
  spent, signals degrade to "unknown" until the next day.
- **If a provider key is wrong**, `/readyz` still says "configured"; the admin page shows the failures. Check there after
  changing keys.
