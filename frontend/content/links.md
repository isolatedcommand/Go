---
title: "Links"
description: "Featured Isolated Command short links — and the live, searchable directory."
subtitle: "A handful of official links. Anyone can create their own on the home page."
layout: docs
lastmod: 2026-07-01
---

> **Go is generally available.** Anyone can create a short link on the [home page](/) —
> no account required. Browse or search every link in the live
> [**link directory**](/search/), which reads directly from Workers KV and shows
> click counts and status.

## Featured Isolated Command links

| Short link | Redirects to |
| --- | --- |
| `go.isolatedcommand.com/github` | Isolated Command on GitHub |
| `go.isolatedcommand.com/linkedin` | Isolated Command on LinkedIn |
| `go.isolatedcommand.com/instagram` | Isolated Command on Instagram |
| `go.isolatedcommand.com/site` | https://isolatedcommand.com |
| `go.isolatedcommand.com/publisher` | The Publisher platform site |
| `go.isolatedcommand.com/volunteer` | The Volunteer Management Portal |

These are official links curated by the Isolated Command Developer Community (DevComm).
Each entry is a key in a Cloudflare Workers KV namespace — see the
[Documentation](/docs/) for how it all fits together.

## Create your own

Head to the [home page](/), paste a destination, and optionally pick a custom name.
Every destination is validated and screened against the service safety policy before
a link is created.

## Behaviour

- A known short link returns an HTTP **302** redirect to its destination (and counts the click).
- A **disabled** or **expired** link shows a friendly notice instead of redirecting.
- An unknown path falls through to this site's **404** page.
- Everything else (this page, the home page, search, docs) is served as a static page from the same Cloudflare Worker.
