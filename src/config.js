/**
 * Configuration loader for the Go shortener.
 *
 * The three JSON files under ../config are imported at build time and cached in
 * module scope for the lifetime of the isolate. That means:
 *   - Zero per-request reads and zero KV lookups to read config (very fast).
 *   - Editing any config/*.json file and redeploying updates the running
 *     application with no code change — the Worker just picks up the new JSON.
 *
 * Blocklists are pre-normalised once (lowercased, de-duped) into fast lookup
 * structures so the hot path (validation) never re-parses the raw arrays.
 */
import settings from "../config/settings.json";
import blockedDomains from "../config/blocked-domains.json";
import blockedKeywords from "../config/blocked-keywords.json";

const domainSet = new Set(
  (blockedDomains || [])
    .map((d) => String(d).trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean)
);

const keywords = (blockedKeywords || [])
  .map((k) => String(k).trim().toLowerCase())
  .filter(Boolean);

export function getSettings() {
  return settings;
}

export function getBlockedDomains() {
  return [...domainSet];
}

export function getBlockedKeywords() {
  return [...keywords];
}

/**
 * True when `hostname` is a blocked apex domain or a subdomain of one.
 * e.g. blocking "pornhub.com" also blocks "www.pornhub.com".
 */
export function isDomainBlocked(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  if (domainSet.has(h)) return true;
  for (const d of domainSet) {
    if (h.endsWith("." + d)) return true;
  }
  return false;
}

/**
 * Returns the first blocked keyword found as a substring of `text`, or null.
 * `text` is expected to already be lowercased + URL-decoded by the caller.
 */
export function matchedKeyword(text) {
  const t = String(text || "").toLowerCase();
  for (const kw of keywords) {
    if (t.includes(kw)) return kw;
  }
  return null;
}
