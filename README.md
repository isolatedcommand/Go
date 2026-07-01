# Go — Isolated Command Link Shortener

`go.isolatedcommand.com` — a URL shortener built **entirely on Cloudflare Workers**,
following the [Cloudflare Workers + KV URL-shortener pattern](https://blog.logrocket.com/creating-url-shortener-cloudflare-workers/),
with a front end on the **Publisher** theme.

One Worker (`src/index.js`) handles every non-asset request:
- `/api/*` → the JSON API (create / search / admin).
- A path that matches a key in the `SHORT_URLS` KV namespace → **302 redirect** (with click analytics).
- A disabled or expired link → a friendly "unavailable" page.
- Anything else → the static Publisher-themed site in `frontend/` (home, search, admin, links, 404).

## Layout

```
Go/
├── src/                # the Worker (ES modules, bundled by wrangler)
│   ├── index.js        #   router: API + KV redirect + static fallback
│   ├── api.js          #   JSON API — create / search / admin CRUD
│   ├── store.js        #   KV data model, search index, HTTPS-only guard
│   ├── validate.js     #   URL validation + SSRF / blocklist screening
│   ├── ratelimit.js    #   per-IP rate limiting + abuse logging (hashed)
│   └── config.js       #   loads + caches config/*.json
├── config/             # editable configuration (no code change to update)
│   ├── settings.json         #   security, rate limits, short-code + pagination
│   ├── blocked-domains.json  #   domains rejected outright
│   └── blocked-keywords.json #   keywords rejected in host/path/query
├── wrangler.toml       # Worker + assets + KV bindings + build command
├── build.sh            # builds the Hugo front end for Cloudflare
├── seed-links.sh       # seeds the initial short links into KV
└── frontend/           # Publisher-themed Hugo child site (static front end)
    ├── layouts/        #   home builder, search + admin pages
    └── static/js/      #   go-create / go-search / go-admin front-end logic
```

## Features

- **Big editable builder** on the home page — type after `go.isolatedcommand.com/` and paste a destination to mint a link.
- **Public, read + create only** — anyone can create a link and search/view the entire directory; editing, disabling and deleting are **admin-only**.
- **Search page** (`/search/`) — search every link by short code, destination or domain, with pagination, copy and open buttons.
- **Admin page** (`/admin/`) — protected by **Cloudflare Access**: search, edit destination, disable / re-enable, delete, and view clicks / created / last-accessed.
- **Security** — destinations are validated before storage: unsafe schemes (`javascript:`, `data:`, `file:`, `blob:`, `chrome:`, `edge:`, `about:`, `mailto:`, `ftp:`), localhost / private-IP / link-local / internal hosts (SSRF), redirect loops back to this app, malformed URLs, blocked domains and blocked keywords are all rejected with a friendly message.
- **Analytics** — per-link click count, created date, last-accessed date, status and optional expiry, updated in `ctx.waitUntil()` so redirects stay fast.
- **Abuse protection** — 20 creations / minute / IP by default; only *hashed* IP + User-Agent are stored, and repeated violations are logged.
- **HTTPS-only KV** — any externally configured KV endpoint must be `https://`, or the Worker refuses to start.

## Configuration

Everything policy-related lives in `config/*.json` and is bundled into the Worker
at deploy time, then cached in memory. **Edit the JSON and redeploy — no code
change is required.** For example, to block another domain, add it to
`config/blocked-domains.json`; to change the rate limit, edit `config/settings.json`.

## One-time setup

```bash
# 1. Create the KV namespace (production + preview) and paste the ids into wrangler.toml
wrangler kv namespace create SHORT_URLS
wrangler kv namespace create SHORT_URLS --preview

# 2. Seed the initial links
./seed-links.sh

# 3. Deploy (build command in wrangler.toml builds the front end first)
wrangler deploy
```

Then add `go.isolatedcommand.com` as a custom domain / route on the Worker.

### Protect the admin area with Cloudflare Access

Admin is gated by Cloudflare Access — the Worker verifies the Access JWT on every
`/admin` and `/api/admin/*` request, so nothing is trusted without a valid login.

1. In the Cloudflare dashboard → **Zero Trust → Access → Applications**, add a
   **self-hosted** application for `go.isolatedcommand.com` covering the path
   `/admin` (the `CF_Authorization` cookie it sets is sent to `/api/admin/*` too,
   which the Worker independently verifies).
2. Add an Access **policy** allowing the people who may manage links (e.g. an
   email domain or group).
3. Copy the application's **Application Audience (AUD) tag** and your team domain
   (`https://<team>.cloudflareaccess.com`) into `config/settings.json`
   (`admin.access.teamDomain` / `admin.access.aud`), or set them as the
   `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` vars (which take precedence). Redeploy.

Until this is configured, all admin endpoints return `503` and the `/admin` page
shows an "admin access required" notice — public create/view is unaffected.

After the first deploy, backfill the search index for any pre-existing plain-string
links (one-off — run from a browser signed in to Access, or with a service token):

```bash
curl -X POST https://go.isolatedcommand.com/api/admin/migrate \
  --cookie "CF_Authorization=<your Access JWT>"
```

## API

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/links` | public (rate-limited) | Create a link `{ dest, code? }` |
| `GET /api/links?q=&cursor=&limit=` | public | Search / list links |
| `GET /api/links/:code` | public | Fetch one link |
| `GET /api/admin/identity` | Access | The signed-in admin's email |
| `PATCH /api/admin/links/:code` | Access | Edit `{ dest?, status?, expiry? }` |
| `DELETE /api/admin/links/:code` | Access | Delete a link |
| `POST /api/admin/migrate` | Access | Backfill metadata for legacy links |

Admin requests are authenticated by the Cloudflare Access JWT (the
`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie), verified by the Worker.

## Adding a link from the CLI (still works)

```bash
wrangler kv key put --binding SHORT_URLS "/talk" "https://example.com/my-talk"
```

Live globally within seconds — no rebuild, no redeploy. Plain-string values written
this way are read transparently; run the `migrate` endpoint to index them for search.

## Local development

```bash
cd frontend && hugo server      # preview the front end
wrangler dev                    # run the Worker + KV locally (from repo root)
```
