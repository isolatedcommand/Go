# Go — Isolated Command Link Shortener

`go.isolatedcommand.com` — a URL shortener built **entirely on Cloudflare Workers**,
following the [Cloudflare Workers + KV URL-shortener pattern](https://blog.logrocket.com/creating-url-shortener-cloudflare-workers/),
with a front end on the **Publisher** theme.

One Worker (`src/index.js`) handles every request:
- A path that matches a key in the `SHORT_URLS` KV namespace → **301 redirect**.
- Anything else → the static Publisher-themed site in `frontend/` (home, links, 404).

## Layout

```
Go/
├── src/index.js        # the Worker (KV redirect + static fallback)
├── wrangler.toml       # Worker + assets + KV bindings + build command
├── build.sh            # builds the Hugo front end for Cloudflare
├── seed-links.sh       # seeds the initial short links into KV
└── frontend/           # Publisher-themed Hugo child site (static front end)
```

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

## Adding a link later

```bash
wrangler kv key put --binding SHORT_URLS "/talk" "https://example.com/my-talk"
```

Live globally within seconds — no rebuild, no redeploy.

## Local development

```bash
cd frontend && hugo server      # preview the front end
wrangler dev                    # run the Worker + KV locally (from repo root)
```
