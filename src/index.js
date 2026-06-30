/**
 * go.isolatedcommand.com — URL shortener on Cloudflare Workers.
 *
 * Routing:
 *   - Static assets (this site's pages) are matched and served by the
 *     [assets] binding automatically, before this Worker runs.
 *   - This Worker therefore only runs for paths that are NOT static assets:
 *     short codes and unknown paths.
 *   - A path that matches a key in the SHORT_URLS KV namespace -> 301 redirect.
 *   - Anything else -> the static 404 page.
 *
 * Based on the Cloudflare Workers + KV URL-shortener pattern
 * (https://blog.logrocket.com/creating-url-shortener-cloudflare-workers/).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Known short link? (support keys stored with or without a leading slash)
    let dest = await env.SHORT_URLS.get(path);
    if (!dest && path.length > 1) {
      dest = await env.SHORT_URLS.get(path.replace(/^\//, ""));
    }
    if (dest) {
      return Response.redirect(dest, 301);
    }

    // 2. Not a short link — serve the static Publisher front end's 404 page.
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
