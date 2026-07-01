/**
 * KV data model + access layer for the Go shortener.
 *
 * Backwards compatibility
 * -----------------------
 * The original shortener stored each link as a plain destination string
 * (e.g. "/github" -> "https://github.com/isolatedcommand"). This module still
 * reads those transparently: a value that isn't JSON is treated as a bare
 * destination. New/edited links are stored as a JSON record AND mirrored into
 * KV metadata, so search/admin listings can read every field straight from
 * `list()` without a per-key read.
 *
 * Record shape (value = JSON, metadata = same fields, trimmed to fit 1 KiB):
 *   { dest, created, clicks, lastAccessed, expiry, status }   status: active|disabled
 *
 * Internal keys (rate-limit counters, abuse log) are prefixed with "__" and are
 * therefore never returned by listLinks(), which lists only the "/" prefix.
 */
import { getSettings } from "./config.js";

const LINK_PREFIX = "/";
const META_DEST_MAX = 512; // keep total metadata under KV's 1 KiB limit

/**
 * Enforce "KV over HTTPS only". The Workers KV binding is HTTPS by design, so
 * this guards any *externally configured* endpoint (settings.kv.endpoint or an
 * env override). An http:// endpoint aborts the request at startup.
 */
export function assertHttpsKv(env) {
  const kv = getSettings().kv || {};
  if (kv.requireHttps === false) return;
  const endpoints = [kv.endpoint, env && env.KV_ENDPOINT].filter(Boolean);
  for (const ep of endpoints) {
    if (!/^https:\/\//i.test(String(ep))) {
      throw new Error(`Refusing to start: KV endpoint "${ep}" is not HTTPS.`);
    }
  }
}

export function normalizeCode(code) {
  let c = String(code || "").trim();
  if (!c.startsWith("/")) c = "/" + c;
  return c;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRecord(rec, meta) {
  rec = rec || {};
  meta = meta || {};
  return {
    dest: rec.dest || rec.url || meta.dest || "",
    created: rec.created || meta.created || null,
    clicks: Number(rec.clicks ?? meta.clicks ?? 0) || 0,
    lastAccessed: rec.lastAccessed || meta.lastAccessed || null,
    expiry: rec.expiry || meta.expiry || null,
    status: rec.status || meta.status || "active",
  };
}

// Parse a stored KV value (JSON record OR legacy plain destination string).
function parseValue(value, meta) {
  if (value == null) return null;
  const t = String(value).trim();
  if (t.startsWith("{")) {
    try {
      return normalizeRecord(JSON.parse(t), meta);
    } catch {
      /* fall through to legacy handling */
    }
  }
  return normalizeRecord({ dest: value }, meta);
}

function toMetadata(rec) {
  const dest =
    rec.dest && rec.dest.length > META_DEST_MAX
      ? rec.dest.slice(0, META_DEST_MAX)
      : rec.dest;
  return {
    dest,
    created: rec.created,
    clicks: rec.clicks,
    lastAccessed: rec.lastAccessed,
    expiry: rec.expiry,
    status: rec.status,
  };
}

/**
 * Fetch a single link by code. One KV read on the hot path; a legacy fallback
 * read (key without the leading slash) only fires when the primary key misses.
 */
export async function getLink(env, code) {
  const key = normalizeCode(code);
  let { value, metadata } = await env.SHORT_URLS.getWithMetadata(key, {
    type: "text",
  });
  if (value == null) {
    const alt = key.replace(/^\//, "");
    if (alt) {
      const r = await env.SHORT_URLS.getWithMetadata(alt, { type: "text" });
      value = r.value;
      metadata = r.metadata;
    }
  }
  if (value == null) return null;
  return { key, ...parseValue(value, metadata) };
}

/**
 * Create/replace a link. Writes the JSON record as the value and mirrors the
 * searchable fields into metadata. Applies expirationTtl when an expiry is set.
 */
export async function putLink(env, code, input) {
  const key = normalizeCode(code);
  const rec = normalizeRecord({
    dest: input.dest,
    created: input.created || nowIso(),
    clicks: input.clicks,
    lastAccessed: input.lastAccessed ?? null,
    expiry: input.expiry ?? null,
    status: input.status || "active",
  });

  const opts = { metadata: toMetadata(rec) };
  if (rec.expiry) {
    const ttl = Math.floor(new Date(rec.expiry).getTime() / 1000) - Math.floor(Date.now() / 1000);
    if (ttl > 60) opts.expirationTtl = ttl;
  }
  await env.SHORT_URLS.put(key, JSON.stringify(rec), opts);
  return { key, ...rec };
}

export async function deleteLink(env, code) {
  await env.SHORT_URLS.delete(normalizeCode(code));
}

/**
 * Record a click. KV has no native atomic increment, so this is a read-modify-
 * write; it runs inside ctx.waitUntil() so it never slows the redirect. Under
 * heavy concurrent traffic to the *same* link a small number of increments can
 * be lost — a Durable Object counter would be required for exact atomicity.
 */
export async function recordClick(env, code) {
  const cur = await getLink(env, code);
  if (!cur) return;
  await putLink(env, code, {
    ...cur,
    clicks: Number(cur.clicks || 0) + 1,
    lastAccessed: nowIso(),
  });
}

/**
 * List/search links straight from KV `list()` metadata (no per-key reads).
 * Legacy links that predate metadata are hydrated with a single read each so
 * search still finds them.
 *
 * @returns {{ items: object[], cursor: string|null, complete: boolean }}
 */
export async function listLinks(env, { cursor, limit } = {}) {
  const res = await env.SHORT_URLS.list({
    prefix: LINK_PREFIX,
    limit: limit || 1000,
    cursor: cursor || undefined,
  });

  const items = [];
  for (const k of res.keys) {
    const meta = k.metadata || {};
    let rec = normalizeRecord({}, meta);
    // Legacy entry (seeded as a bare string, no metadata) — hydrate once.
    if (!meta.dest) {
      const full = await getLink(env, k.name);
      if (full) rec = { dest: full.dest, created: full.created, clicks: full.clicks, lastAccessed: full.lastAccessed, expiry: full.expiry, status: full.status };
    }
    items.push({ key: k.name, code: k.name, ...rec });
  }

  return {
    items,
    cursor: res.list_complete ? null : res.cursor,
    complete: res.list_complete,
  };
}

/** Case-insensitive filter over short code, destination and hostname. */
export function matchesQuery(item, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  let host = "";
  try {
    host = new URL(item.dest).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  return (
    item.code.toLowerCase().includes(needle) ||
    (item.dest || "").toLowerCase().includes(needle) ||
    host.includes(needle)
  );
}
