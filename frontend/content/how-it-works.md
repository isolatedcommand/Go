---
title: "How it works"
description: "The architecture behind go.isolatedcommand.com — Cloudflare Workers + Workers KV."
subtitle: "A single Worker serves this site and redirects every short link."
layout: docs
lastmod: 2026-06-30
---

## Overview

**Go** is a URL shortener built entirely on **Cloudflare Workers**, following the well-known pattern of pairing a Worker with **Workers KV** for storage. One Worker handles every request to `go.isolatedcommand.com`:

- If the path matches a key in the KV store → it returns a **301 redirect** to the destination.
- Otherwise → it serves this **Publisher-themed static site** (homepage, links directory, 404).

There is no origin server and no database in the request path — just the edge.

## Storage: Workers KV

Short links are stored as simple key → value pairs in a KV namespace bound to the Worker as `SHORT_URLS`:

```
"/github"    → "https://github.com/isolatedcommand"
"/linkedin"  → "https://www.linkedin.com/company/isolatedcommand"
"/instagram" → "https://instagram.com/isolatedcommand"
```

Adding a link is a single command — no rebuild, no deploy:

```bash
wrangler kv key put --binding SHORT_URLS "/github" "https://github.com/isolatedcommand"
```

## The Worker

The Worker reads the request path, looks it up in KV, and redirects when it finds a match. If there is no match, it hands the request to the static-asset binding so this site is served instead:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Is this path a known short link?
    let dest = await env.SHORT_URLS.get(path);
    if (!dest && path.length > 1) {
      dest = await env.SHORT_URLS.get(path.replace(/^\//, ""));
    }
    if (dest) {
      return Response.redirect(dest, 301);
    }

    // 2. Not a short link — serve the static Publisher site (404 page).
    const notFound = await env.ASSETS.fetch(new URL("/404.html", url.origin));
    return new Response(notFound.body, { status: 404, headers: notFound.headers });
  },
};
```

Static pages (this site) are matched and served automatically by the assets binding **before** the Worker runs, so the Worker only ever executes for short codes and unknown paths.

## Configuration

The Worker, its KV namespace, and the static front end are wired together in `wrangler.toml`:

```toml
name = "go-isolatedcommand"
main = "src/index.js"
compatibility_date = "2025-07-31"

[assets]
directory = "./frontend/public"
binding = "ASSETS"
not_found_handling = "none"

[[kv_namespaces]]
binding = "SHORT_URLS"
id = "<your-kv-namespace-id>"
```

## Why this design

- **Fast** — redirects resolve at the edge, close to the user, with no cold origin.
- **Cheap & scalable** — static assets and KV reads scale effortlessly.
- **Secure** — no application server to attack; the same static-first model as the rest of the [Publisher platform](https://publisher.devcomm).
- **Simple to operate** — adding or changing a link is one KV write, live worldwide in seconds.

> The front end you are reading is a [Publisher](https://isolatedcommand.com) child site; the redirector is the Worker in front of it. Same platform, one deployment.
