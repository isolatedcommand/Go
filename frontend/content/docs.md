---
title: "Documentation"
description: "Everything about Go — features, security, backend technology, API and self-hosting."
subtitle: "Go is a free, open-source URL shortener from the Isolated Command Developer Community (DevComm). This is the complete guide."
layout: docs
lastmod: 2026-07-01
---

## Overview

**Go** (`go.isolatedcommand.com`) is a free, open-source URL shortener maintained by
the **Isolated Command Developer Community (DevComm)**. It is **generally available** —
anyone can create a short link and browse the public directory, with no account required.

It runs **entirely on Cloudflare Workers** and **Workers KV**: there is no origin
server and no database to operate. Requests are handled at Cloudflare's global edge,
so redirects resolve close to the user, worldwide.

- **Public:** create links and search the whole directory.
- **Admin (DevComm maintainers):** edit, disable, re-enable and delete links, behind Cloudflare Access.

## Features

| Area | What you get |
| --- | --- |
| Short links | Random or custom codes at `go.isolatedcommand.com/<name>` |
| Directory | Public, searchable list of every link (code, destination, domain) |
| Analytics | Click count, created date, last-accessed date, status, optional expiry |
| Security | Scheme allow-list, SSRF protection, blocked domains & keywords, HTTPS-only |
| Abuse control | Per-IP rate limiting with hashed identifiers and abuse logging |
| Admin console | Edit / disable / delete, protected by Cloudflare Access |
| Configuration | Editable JSON blocklists & settings — no code change to update |
| API | Simple JSON API for create, search and admin actions |

## Backend technology

Go is deliberately small and serverless. One Worker handles every request.

| Layer | Technology | Role |
| --- | --- | --- |
| Runtime | **Cloudflare Workers** | Executes routing, validation, redirects and the API at the edge |
| Storage | **Workers KV** | Stores link records (`code → {dest, clicks, status, …}`) as key/value + searchable metadata |
| Front end | **Hugo** + the **Publisher** theme | Static site (home, search, admin, docs), served by the Worker's assets binding |
| Auth | **Cloudflare Access (Zero Trust)** | Authenticates admins; the Worker verifies the Access JWT |
| Tooling | **Wrangler**, **esbuild** | Build & deploy; config JSON is bundled into the Worker |

### Request flow

```
Browser ─▶ Cloudflare Edge ─▶ Worker
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                          ▼
  /api/*  →  JSON API     path in KV  →  302 redirect   else  →  static site / 404
                          (+ click analytics)
```

- **Static assets** (home, `/search/`, `/docs/`, `/admin/`) are matched and served
  by the assets binding **before** the Worker runs.
- **`/api/*`** is handled by the Worker's JSON API.
- **Any other path** is looked up in KV: a match is a `302` redirect (302, not 301,
  so a link can be disabled or edited and take effect immediately); no match falls
  through to the static `404`.

### Data model

Each link is a KV record. Legacy plain-string values are still read transparently.

```json
{
  "dest": "https://example.com/page",
  "created": "2026-07-01T00:00:00.000Z",
  "clicks": 42,
  "lastAccessed": "2026-07-01T09:30:00.000Z",
  "expiry": null,
  "status": "active"
}
```

The searchable fields are mirrored into KV **metadata**, so the directory and admin
console can list and search links from `list()` alone — without a read per key.
Click counts are incremented after the redirect (in `waitUntil`) so redirects stay fast.

## Security

Security is enforced in the Worker, **before** any link is stored, so an unsafe or
policy-violating destination can never be saved and therefore never served.

### URL validation

Every destination must parse as a valid URL and pass all of the following:

- **Scheme allow-list** — only `http:` and `https:` are permitted. Unsafe schemes are
  rejected outright: `javascript:`, `data:`, `file:`, `blob:`, `chrome:`, `edge:`,
  `about:`, `mailto:`, `ftp:`.
- **SSRF protection** — links to internal or non-routable hosts are blocked:
  `localhost`, `*.local` / `*.internal` / `*.lan`, and private / loopback / link-local
  IP ranges — IPv4 (`10/8`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`,
  CGNAT `100.64/10`, and more) and IPv6 (`::1`, `fc00::/7`, `fe80::/10`, v4-mapped).
- **Redirect-loop prevention** — a destination can't point back at the shortener's own hostnames.
- **Malformed URLs** — anything unparseable is rejected with a friendly message.

### Content blocklists

Two editable lists screen destinations:

- **Blocked domains** (`config/blocked-domains.json`) — the hostname and its subdomains
  are rejected.
- **Blocked keywords** (`config/blocked-keywords.json`) — matched (case-insensitively)
  against the host, path and query.

Update either file and redeploy — no code change. A blocked destination returns a
clear message explaining it violates the service policy.

### Transport & abuse

- **HTTPS only** — the KV/transport policy requires HTTPS; a non-HTTPS endpoint aborts startup.
- **Rate limiting** — creation is limited per client IP (default **20 / minute**).
  Only **hashed** IP and User-Agent values are stored (with a timestamp); raw
  identifiers never touch KV. Repeated violations are logged.

### Admin authentication — Cloudflare Access

The `/admin` page and all `/api/admin/*` endpoints are protected by **Cloudflare
Access**. Access authenticates the user at the edge and issues a signed JWT; the
Worker independently **verifies that JWT** on every admin request:

1. RS256 signature against the team's public keys (JWKS).
2. `iss` equals the configured team domain.
3. `aud` includes the configured Access application.
4. `exp` / `nbf` are currently valid.

So even a request that reached the API directly cannot mutate data without a valid
Access login. The public API is **read + create only**; all edits, disables and
deletes require Access.

## Using Go

### Create a link

Type your destination on the home page. Optionally set a custom name after the
slash — letters, numbers and `- . _ ~`, up to 64 characters. Reserved words
(`api`, `admin`, `search`, `docs`, `links`, …) can't be used. Leave the name blank
for a random 6-character code.

### Find a link

The **Search** page reads live from Workers KV. Search by short code, destination
URL or domain, page through results, and copy or open any link.

## API

Base URL: `https://go.isolatedcommand.com`

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/links` | public (rate-limited) | Create a link — body `{ "dest": "…", "code": "optional" }` |
| `GET /api/links?q=&cursor=&limit=` | public | Search / list links |
| `GET /api/links/:code` | public | Fetch one link |
| `GET /api/admin/identity` | Access | The signed-in admin's email |
| `PATCH /api/admin/links/:code` | Access | Edit `{ dest?, status?, expiry? }` |
| `DELETE /api/admin/links/:code` | Access | Delete a link |
| `POST /api/admin/migrate` | Access | Backfill metadata for legacy links |

Create example:

```bash
curl -X POST https://go.isolatedcommand.com/api/links \
  -H "content-type: application/json" \
  -d '{"dest":"https://example.com/page","code":"demo"}'
# → { "link": { "code": "demo", "shortUrl": "https://go.isolatedcommand.com/demo", ... } }
```

## Configuration

All policy lives in `config/*.json`, bundled into the Worker at deploy and cached in
memory. Edit the JSON and redeploy — **no code change required**.

| File | Controls |
| --- | --- |
| `settings.json` | Security switches, rate limits, short-code rules, pagination, Access team domain + AUD |
| `blocked-domains.json` | Domains rejected outright |
| `blocked-keywords.json` | Keywords rejected in host/path/query |

## Self-hosting guide

Go is open source — you can run your own instance.

```bash
# 1. Clone
git clone https://github.com/isolatedcommand/Go && cd Go

# 2. Create the KV namespace and paste the ids into wrangler.toml
wrangler kv namespace create SHORT_URLS
wrangler kv namespace create SHORT_URLS --preview

# 3. (Optional) seed initial links
./seed-links.sh

# 4. Deploy — the build step builds the Hugo front end first
wrangler deploy
```

Point your domain at the Worker (custom domain / route). To enable admin, create a
**Cloudflare Access** self-hosted application for the `/admin` path and put its team
domain + AUD in `config/settings.json` (or the `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`
vars). Add or change a link any time with a single KV write — live worldwide in seconds:

```bash
wrangler kv key put --binding SHORT_URLS "/talk" "https://example.com/my-talk"
```

## Contributing

Go is a DevComm community project. Issues and pull requests are welcome on
[GitHub](https://github.com/isolatedcommand/Go) — whether it's a blocklist entry,
a security hardening, a docs fix or a new feature. Please keep the architecture
serverless and the design consistent with the Publisher theme.

> Built and maintained by the **Isolated Command Developer Community (DevComm)**.
> Same platform, one deployment, open to all.
