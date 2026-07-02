/**
 * JSON API for the Go shortener, mounted at /api/*.
 *
 * Public
 *   POST   /api/links              create a short link  (validated + rate-limited)
 *   GET    /api/links              search/list links    (?q=&cursor=&limit=)
 *   GET    /api/links/:code        fetch one link
 *
 * Admin  (protected by Cloudflare Access — the Worker verifies the Access JWT)
 *   GET    /api/admin/identity     who am I (email from the Access JWT)
 *   PATCH  /api/admin/links/:code  edit destination / status / expiry
 *   DELETE /api/admin/links/:code  delete a link
 *   POST   /api/admin/migrate      backfill metadata for legacy links
 *
 * The public endpoints are read + create only; every mutation lives under
 * /api/admin and requires Cloudflare Access. Reuses the same store, validation
 * and rate-limit modules as the redirect path — no duplicated logic.
 */
import { getSettings } from "./config.js";
import { validateDestination } from "./validate.js";
import { verifyAccess } from "./access.js";
import { checkRateLimit } from "./ratelimit.js";
import {
  getLink,
  putLink,
  deleteLink,
  listLinks,
  matchesQuery,
  normalizeCode,
} from "./store.js";

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

/* ---- admin auth (Cloudflare Access) ------------------------------------- */

// Returns { identity } when authorised, or { denied: Response } otherwise.
async function requireAccess(request, env) {
  const res = await verifyAccess(request, env);
  if (!res.configured) {
    return {
      denied: json(
        { error: "Admin is protected by Cloudflare Access, which isn’t configured yet. Set settings.admin.access (team domain + AUD) or the ACCESS_TEAM_DOMAIN / ACCESS_AUD env vars." },
        503
      ),
    };
  }
  if (!res.ok) {
    return { denied: json({ error: "Unauthorized — sign in through Cloudflare Access." }, 401) };
  }
  return { identity: res };
}

/* ---- short-code helpers ------------------------------------------------- */

function generateCode(settings) {
  const { length, alphabet } = settings.shortCode;
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[arr[i] % alphabet.length];
  return s;
}

// Validate a user-supplied custom code. Returns { ok, code, reason }.
function normalizeCustomCode(raw, settings) {
  let c = String(raw || "").trim().replace(/^\/+/, "");
  const sc = settings.shortCode;
  if (c.length < (sc.minCustomLength || 1))
    return { ok: false, reason: "The custom link is too short." };
  if (c.length > (sc.maxCustomLength || 64))
    return { ok: false, reason: "The custom link is too long." };
  if (!/^[A-Za-z0-9._~-]+$/.test(c))
    return {
      ok: false,
      reason: "Custom links may only contain letters, numbers, and - . _ ~ characters.",
    };
  if ((sc.reserved || []).includes(c.toLowerCase()))
    return { ok: false, reason: `“${c}” is reserved and can’t be used.` };
  return { ok: true, code: c };
}

function publicView(link, settings) {
  const base = (settings.app?.baseUrl || "").replace(/\/$/, "");
  const code = String(link.code || link.key).replace(/^\//, "");
  return {
    code,
    shortUrl: base + normalizeCode(code),
    dest: link.dest,
    created: link.created,
    clicks: link.clicks || 0,
    lastAccessed: link.lastAccessed || null,
    expiry: link.expiry || null,
    status: link.status || "active",
  };
}

/* ---- endpoints ---------------------------------------------------------- */

async function createLink(request, env) {
  const settings = getSettings();

  const rl = await checkRateLimit(env, request);
  if (!rl.allowed) {
    return json(
      { error: `Rate limit exceeded — max ${settings.rateLimit.maxCreatesPerWindow} links per ${settings.rateLimit.windowSeconds}s. Please slow down.` },
      429,
      { "retry-after": String(rl.retryAfter || 60) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const check = validateDestination(body.dest, request.url);
  if (!check.ok) return json({ error: check.reason }, 400);

  // Resolve the short code: custom (validated) or generated (collision-checked).
  let code;
  if (body.code && String(body.code).trim()) {
    const nc = normalizeCustomCode(body.code, settings);
    if (!nc.ok) return json({ error: nc.reason }, 400);
    code = nc.code;
    const existing = await getLink(env, code);
    if (existing) return json({ error: `“${code}” is already taken. Try another.` }, 409);
  } else {
    for (let i = 0; i < 6; i++) {
      const candidate = generateCode(settings);
      if (!(await getLink(env, candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) return json({ error: "Couldn’t allocate a unique short code, please retry." }, 500);
  }

  const saved = await putLink(env, code, {
    dest: check.url,
    status: "active",
    clicks: 0,
    expiry: body.expiry || null,
  });

  return json({ link: publicView(saved, settings) }, 201);
}

async function searchLinks(request, env) {
  const settings = getSettings();
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || undefined;
  const pg = settings.pagination || {};
  let limit = Number(url.searchParams.get("limit")) || pg.defaultPageSize || 20;
  limit = Math.min(Math.max(1, limit), pg.maxPageSize || 100);

  // When searching we scan a larger KV page then filter; otherwise page directly.
  const scan = q ? Math.max(limit * 5, 200) : limit;
  const { items, cursor: nextCursor } = await listLinks(env, { cursor, limit: scan });
  const filtered = q ? items.filter((i) => matchesQuery(i, q)) : items;
  const page = filtered.slice(0, limit);

  return json({
    results: page.map((l) => publicView(l, settings)),
    cursor: nextCursor,
    count: page.length,
  });
}

async function getOne(env, code) {
  const settings = getSettings();
  const link = await getLink(env, code);
  if (!link) return json({ error: "Not found." }, 404);
  return json({ link: publicView({ ...link, code: link.key }, settings) });
}

async function editLink(request, env, code) {
  const settings = getSettings();
  const existing = await getLink(env, code);
  if (!existing) return json({ error: "Not found." }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const next = { ...existing };

  if (body.dest !== undefined) {
    const check = validateDestination(body.dest, request.url);
    if (!check.ok) return json({ error: check.reason }, 400);
    next.dest = check.url;
  }
  if (body.status !== undefined) {
    if (!["active", "disabled"].includes(body.status))
      return json({ error: "status must be 'active' or 'disabled'." }, 400);
    next.status = body.status;
  }
  if (body.expiry !== undefined) next.expiry = body.expiry || null;

  const saved = await putLink(env, existing.key, next);
  return json({ link: publicView({ ...saved, code: existing.key }, settings) });
}

async function removeLink(env, code) {
  const existing = await getLink(env, code);
  if (!existing) return json({ error: "Not found." }, 404);
  await deleteLink(env, existing.key);
  return json({ ok: true, deleted: existing.key });
}

// Rewrite every link so it carries searchable metadata (one-time legacy fix).
async function migrateLegacy(env) {
  let cursor;
  let migrated = 0;
  do {
    const { items, cursor: next } = await listLinks(env, { cursor, limit: 1000 });
    for (const item of items) {
      await putLink(env, item.key, item);
      migrated++;
    }
    cursor = next;
  } while (cursor);
  return json({ ok: true, migrated });
}

/* ---- router ------------------------------------------------------------- */

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","links","abc"]
  const method = request.method.toUpperCase();

  // /api/stats — public aggregate counters for the home page.
  if (parts[1] === "stats" && method === "GET") {
    let cursor;
    let links = 0;
    let clicks = 0;
    do {
      const { items, cursor: next } = await listLinks(env, { cursor, limit: 1000 });
      for (const it of items) {
        links += 1;
        clicks += Number(it.clicks || 0);
      }
      cursor = next;
    } while (cursor);
    return json({ links, clicks }, 200, { "cache-control": "public, max-age=60" });
  }

  // /api/links ...
  if (parts[1] === "links") {
    const code = parts.slice(2).join("/");
    if (!code) {
      if (method === "POST") return createLink(request, env);
      if (method === "GET") return searchLinks(request, env);
      return json({ error: "Method not allowed." }, 405);
    }
    if (method === "GET") return getOne(env, code);
    return json({ error: "Method not allowed." }, 405);
  }

  // /api/admin ... (Cloudflare Access required)
  if (parts[1] === "admin") {
    const gate = await requireAccess(request, env);
    if (gate.denied) return gate.denied;

    if (parts[2] === "identity" && method === "GET")
      return json({ ok: true, email: gate.identity.email || null });

    if (parts[2] === "migrate" && method === "POST") return migrateLegacy(env);

    if (parts[2] === "links") {
      const code = parts.slice(3).join("/");
      if (!code) return json({ error: "A link code is required." }, 400);
      if (method === "PATCH") return editLink(request, env, code);
      if (method === "DELETE") return removeLink(env, code);
      if (method === "GET") return getOne(env, code);
      return json({ error: "Method not allowed." }, 405);
    }

    return json({ error: "Unknown admin endpoint." }, 404);
  }

  return json({ error: "Unknown API endpoint." }, 404);
}
