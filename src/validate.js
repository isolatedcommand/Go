/**
 * Destination URL validation for the Go shortener.
 *
 * Every short link is validated here BEFORE it is written to KV, so an unsafe
 * or policy-violating destination can never be stored (and therefore can never
 * be served as a redirect). Checks, in order:
 *
 *   1. Parseable URL / non-empty.
 *   2. Scheme allow-list (only http/https) + explicit unsafe-scheme block-list
 *      (javascript:, data:, file:, blob:, chrome:, edge:, about:, mailto:, ftp:).
 *   3. localhost / *.local / *.internal hostnames.
 *   4. Private, loopback, link-local and other reserved IP ranges (SSRF).
 *   5. Redirect loops back to this application.
 *   6. Blocked domains (config/blocked-domains.json).
 *   7. Blocked keywords in host + path + query (config/blocked-keywords.json).
 */
import {
  getSettings,
  isDomainBlocked,
  matchedKeyword,
} from "./config.js";

function fail(reason) {
  return { ok: false, reason, url: null };
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/* ---- IP-range helpers (SSRF protection) --------------------------------- */

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inV4Range(n, base, bits) {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

// True for any non-publicly-routable IPv4 address.
function isPrivateIPv4(host) {
  const n = ipv4ToInt(host);
  if (n === null) return false;
  return (
    inV4Range(n, "0.0.0.0", 8) || // "this" network
    inV4Range(n, "10.0.0.0", 8) || // private
    inV4Range(n, "100.64.0.0", 10) || // carrier-grade NAT
    inV4Range(n, "127.0.0.0", 8) || // loopback
    inV4Range(n, "169.254.0.0", 16) || // link-local
    inV4Range(n, "172.16.0.0", 12) || // private
    inV4Range(n, "192.0.0.0", 24) || // IETF protocol assignments
    inV4Range(n, "192.0.2.0", 24) || // TEST-NET-1
    inV4Range(n, "192.168.0.0", 16) || // private
    inV4Range(n, "198.18.0.0", 15) || // benchmarking
    n >= ipv4ToInt("224.0.0.0") // multicast + reserved + broadcast
  );
}

// True for loopback / unique-local / link-local IPv6 (and v4-mapped forms).
function isPrivateIPv6(host) {
  let h = String(host).toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  const mapped = h.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const first = h.split(":")[0];
  if (/^f[cd][0-9a-f]{0,2}$/.test(first)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]?$/.test(first)) return true; // fe80::/10 link-local
  return false;
}

function isLocalHostname(host) {
  const h = host.replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h === "0.0.0.0" ||
    h === "[::]"
  );
}

// True when the destination host is one of this application's own hostnames
// (a redirect loop back into the shortener), including the current request host.
function isSelfHost(host, settings, requestUrl) {
  const own = new Set(
    (settings.app?.hostnames || []).map((h) => String(h).toLowerCase())
  );
  try {
    if (requestUrl) own.add(new URL(requestUrl).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  return own.has(host);
}

/**
 * Validate a raw destination string.
 * @param {string} rawUrl  the user-supplied destination
 * @param {string} [requestUrl]  the incoming request URL (for self-redirect detection)
 * @returns {{ ok: boolean, reason: string, url: string|null, hostname?: string }}
 */
export function validateDestination(rawUrl, requestUrl) {
  const settings = getSettings();
  const sec = settings.security || {};

  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return fail("Please provide a destination URL.");
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return fail("That destination doesn’t look like a valid URL. Include the scheme, e.g. https://example.com");
  }

  const scheme = url.protocol.toLowerCase();

  if ((sec.blockedSchemes || []).includes(scheme)) {
    return fail(`The “${scheme}” scheme is not allowed for security reasons.`);
  }
  if (sec.allowedSchemes && !sec.allowedSchemes.includes(scheme)) {
    return fail(`Only ${(sec.allowedSchemes || []).join(" and ")} links can be shortened.`);
  }
  if (sec.requireHttpsDestination && scheme !== "https:") {
    return fail("Only HTTPS destinations are allowed.");
  }

  const host = url.hostname.toLowerCase();
  if (!host) return fail("The destination URL is missing a hostname.");

  if (sec.blockLocalhost && isLocalHostname(host)) {
    return fail("Links to localhost or internal hostnames are not allowed.");
  }
  if (sec.blockPrivateNetworks && (isPrivateIPv4(host) || isPrivateIPv6(host))) {
    return fail("Links to private, loopback or internal IP addresses are not allowed.");
  }
  if (sec.blockSelfRedirect && isSelfHost(host, settings, requestUrl)) {
    return fail("The destination can’t point back to this shortener — that would create a redirect loop.");
  }

  if (isDomainBlocked(host)) {
    return fail("This destination is on the service blocklist and violates our content policy.");
  }

  const haystack = decodeSafe(host + url.pathname + url.search).toLowerCase();
  const kw = matchedKeyword(haystack);
  if (kw) {
    return fail("This destination matches content that violates our service policy and can’t be shortened.");
  }

  return { ok: true, reason: "", url: url.toString(), hostname: host };
}
