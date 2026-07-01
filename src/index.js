/**
 * go.isolatedcommand.com — URL shortener on Cloudflare Workers.
 *
 * Routing (static assets are matched + served by the [assets] binding BEFORE
 * this Worker runs, so the Worker only ever sees non-asset paths):
 *
 *   /api/*                     -> JSON API (create / search / admin)  — src/api.js
 *   path matching a KV key     -> themed 5-second interstitial, then redirect (+ click analytics)
 *   disabled / expired link    -> friendly "unavailable" page
 *   anything else              -> the static Publisher 404 page
 *
 * Rather than an instant 301/302, a known link serves a Publisher-themed
 * interstitial (the /redirect/ page) that counts down 5 seconds and then sends
 * the visitor on — showing the destination and how many times it's been used.
 *
 * Based on the Cloudflare Workers + KV URL-shortener pattern
 * (https://blog.logrocket.com/creating-url-shortener-cloudflare-workers/).
 */
import { handleApi } from "./api.js";
import { assertHttpsKv, getLink, recordClick } from "./store.js";

let httpsChecked = false;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Serve the themed interstitial (the built /redirect/ page) with the link's
// details injected in place of the __GO_*__ tokens.
async function interstitial(env, url, link) {
  if (!env.ASSETS) return Response.redirect(link.dest, 302);
  const res = await env.ASSETS.fetch(new URL("/redirect/index.html", url.origin));
  let html = await res.text();
  const code = link.key.replace(/^\//, "");
  const values = {
    __GO_DEST__: escapeHtml(link.dest),
    __GO_DEST_DISPLAY__: escapeHtml(link.dest),
    __GO_CODE__: escapeHtml(code),
    __GO_CLICKS__: String(link.clicks || 0),
    __GO_WAIT__: "5",
  };
  html = html.replace(/__GO_[A-Z_]+__/g, (m) => (m in values ? values[m] : ""));
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function policyPage(title, message, status) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Go</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1120;color:#e8eefb;text-align:center;padding:2rem;}
  .card{max-width:34rem;}
  h1{color:#3272c8;font-size:2rem;margin:0 0 .6rem;}
  p{opacity:.85;line-height:1.6;}
  a{color:#3272c8;font-weight:600;text-decoration:none;}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a href="/">Go home</a> &nbsp;·&nbsp; <a href="/search/">Search links</a></p></div></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, ctx) {
    // Enforce "KV over HTTPS only" once per isolate (cheap after the first call).
    if (!httpsChecked) {
      assertHttpsKv(env);
      httpsChecked = true;
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 1. JSON API.
    if (path === "/api" || path.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // 2. Known short link?
    const link = await getLink(env, path);
    if (link && link.dest) {
      if (link.status === "disabled") {
        return policyPage(
          "Link disabled",
          "This short link has been disabled by an administrator.",
          410
        );
      }
      if (link.expiry && Date.parse(link.expiry) <= Date.now()) {
        return policyPage(
          "Link expired",
          "This short link has expired and is no longer active.",
          410
        );
      }
      // Count the click, then serve the themed 5-second interstitial.
      ctx.waitUntil(recordClick(env, link.key));
      return interstitial(env, url, link);
    }

    // 3. Not a short link — serve the static Publisher front end's 404 page.
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(new URL("/404.html", url.origin));
      return new Response(res.body, { status: 404, headers: res.headers });
    }
    return new Response(
      `No short link for '${path}'. Visit https://go.isolatedcommand.com/links/`,
      { status: 404, headers: { "content-type": "text/plain" } }
    );
  },
};
