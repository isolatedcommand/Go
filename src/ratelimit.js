/**
 * Abuse protection for link creation.
 *
 * A fixed-window counter per client IP (default 20 creations / 60s). Only
 * *hashed* identifiers are ever stored — the raw IP and User-Agent never touch
 * KV — so counters can't be used to track individuals. Repeated violations are
 * accumulated in an abuse log and warned to the Worker console once they cross
 * a threshold.
 *
 * Counters live in the same KV namespace under the reserved "__rl:" / "__abuse:"
 * prefixes and carry an expirationTtl so they self-clean. Note KV is eventually
 * consistent, so the limit is approximate at the edge — appropriate for abuse
 * mitigation rather than hard quota enforcement.
 */
import { getSettings } from "./config.js";

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input || ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashValue(value) {
  return (await sha256Hex(value)).slice(0, 32);
}

export function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Check + record one creation attempt for the request's client.
 * @returns {{ allowed: boolean, count: number, retryAfter?: number }}
 */
export async function checkRateLimit(env, request) {
  const cfg = getSettings().rateLimit || {};
  if (!cfg.enabled) return { allowed: true, count: 0 };

  const windowSec = cfg.windowSeconds || 60;
  const max = cfg.maxCreatesPerWindow || 20;

  const ipHash = await hashValue(clientIp(request));
  const uaHash = await hashValue(request.headers.get("user-agent") || "");
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `__rl:${ipHash}:${bucket}`;

  const cur = await env.SHORT_URLS.get(key, { type: "json" });
  const count = (cur ? Number(cur.count) : 0) + 1;

  await env.SHORT_URLS.put(
    key,
    JSON.stringify({ count, ipHash, uaHash, ts: new Date().toISOString() }),
    { expirationTtl: windowSec * 2 }
  );

  if (count > max) {
    await logAbuse(env, { ipHash, uaHash, count });
    return { allowed: false, count, retryAfter: windowSec };
  }
  return { allowed: true, count };
}

async function logAbuse(env, { ipHash, uaHash, count }) {
  const cfg = getSettings().rateLimit || {};
  const key = `__abuse:${ipHash}`;
  const cur = await env.SHORT_URLS.get(key, { type: "json" });
  const attempts = (cur ? Number(cur.attempts) : 0) + 1;

  await env.SHORT_URLS.put(
    key,
    JSON.stringify({
      ipHash,
      uaHash,
      attempts,
      lastCount: count,
      lastSeen: new Date().toISOString(),
    }),
    { expirationTtl: cfg.abuseRetentionSeconds || 86400 }
  );

  if (attempts >= (cfg.abuseThreshold || 3)) {
    console.warn(
      `[go][abuse] repeated rate-limit violations ipHash=${ipHash} attempts=${attempts} lastCount=${count}`
    );
  }
}
