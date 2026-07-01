---
title: "How it works"
description: "The architecture behind go.isolatedcommand.com — Cloudflare Workers + Workers KV, in brief."
subtitle: "A single Worker serves this site, screens every link, and redirects from the edge. For the full guide, see the Documentation."
layout: docs
lastmod: 2026-07-01
---

## In one paragraph

**Go** is a free, open-source URL shortener from the **Isolated Command Developer
Community (DevComm)**, running entirely on **Cloudflare Workers** and **Workers KV**.
One Worker handles every request to `go.isolatedcommand.com`: it serves this static
site, exposes a small JSON API, screens and stores new links, and redirects known
short codes — all from Cloudflare's global edge. There is no origin server and no
database in the request path.

## The three jobs of the Worker

1. **Serve the site.** The home page, [search](/search/), docs and admin pages are a
   static [Publisher](https://isolatedcommand.com)-themed Hugo build, served by the
   Worker's assets binding.
2. **Handle the API.** Requests to `/api/*` create links (validated, screened and
   rate-limited) or read the public directory.
3. **Redirect.** Any other path is looked up in Workers KV. A match returns a **302**
   redirect to the destination and counts the click; anything else falls through to
   the **404** page.

## Storage

Short links are key → record pairs in a KV namespace bound as `SHORT_URLS`:

```
"/github"    → { "dest": "https://github.com/isolatedcommand", "clicks": …, "status": "active" }
"/publisher" → { "dest": "https://publisher.devcomm.isolatedcommand.com", … }
```

Adding or changing a link is a single KV write — live worldwide in seconds, no rebuild.

## Want the details?

The full architecture, **security model**, **backend technology**, **API reference**
and **self-hosting guide** live on the [Documentation](/docs/) page.

> Go is open source. Read the code, file an issue, or send a pull request on
> [GitHub](https://github.com/isolatedcommand/Go).
