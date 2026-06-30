---
title: "Links"
description: "The directory of active go.isolatedcommand.com short links."
subtitle: "Every short link currently served by the Go redirector."
layout: docs
lastmod: 2026-06-30
---

## Active short links

| Short link | Redirects to |
| --- | --- |
| `go.isolatedcommand.com/github` | Isolated Command on GitHub |
| `go.isolatedcommand.com/linkedin` | Isolated Command on LinkedIn |
| `go.isolatedcommand.com/instagram` | Isolated Command on Instagram |
| `go.isolatedcommand.com/site` | https://isolatedcommand.com |
| `go.isolatedcommand.com/publisher` | The Publisher platform site |
| `go.isolatedcommand.com/volunteer` | The Volunteer Management Portal |

> Links are managed by the Isolated Command Developer Community. Each entry is a key in a Cloudflare Workers KV namespace — see [How it works](/how-it-works/).

## Requesting a new link

Need a short link for a campaign, document or project? Reach out to the ICDC. A new link is a single key added to the KV store and is live globally within seconds — no deployment required.

## Behaviour

- A known short link returns an HTTP **301** redirect to its destination.
- An unknown path falls through to this site's **404** page.
- Everything else (this directory, the homepage) is served as a static page from the same Cloudflare Worker.
