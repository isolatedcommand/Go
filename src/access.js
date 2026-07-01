/**
 * Cloudflare Access authentication for admin endpoints.
 *
 * The /admin page and the /api/admin/* endpoints are protected by a Cloudflare
 * Access application. Access authenticates the user at the edge and forwards a
 * signed JWT — as the `Cf-Access-Jwt-Assertion` header and/or the
 * `CF_Authorization` cookie. This module verifies that JWT server-side so the
 * Worker never trusts an unauthenticated request, even if Access were bypassed:
 *
 *   1. Signature — RS256, verified against the team's public JWKS.
 *   2. `iss`     — must equal the configured team domain.
 *   3. `aud`     — must include the configured Access application AUD.
 *   4. `exp`/`nbf` — must be currently valid.
 *
 * Config comes from settings.admin.access (teamDomain + aud), overridable by the
 * ACCESS_TEAM_DOMAIN / ACCESS_AUD env vars. The JWKS is cached in module scope.
 */
import { getSettings } from "./config.js";

let jwksCache = { url: null, keys: null, exp: 0 };

function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

function accessConfig(env) {
  const a = (getSettings().admin && getSettings().admin.access) || {};
  let teamDomain = ((env && env.ACCESS_TEAM_DOMAIN) || a.teamDomain || "").trim().replace(/\/$/, "");
  const aud = ((env && env.ACCESS_AUD) || a.aud || "").trim();
  if (teamDomain && !/^https?:\/\//i.test(teamDomain)) teamDomain = "https://" + teamDomain;
  // Treat the shipped placeholders as "not configured".
  if (!teamDomain || !aud || /YOUR-TEAM|YOUR_ACCESS/i.test(teamDomain + aud)) {
    return { configured: false };
  }
  return { configured: true, teamDomain, aud, certsUrl: teamDomain + "/cdn-cgi/access/certs" };
}

function getToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getKeys(certsUrl) {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.url === certsUrl && jwksCache.exp > now) {
    return jwksCache.keys;
  }
  const res = await fetch(certsUrl, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error("Access certs fetch failed: " + res.status);
  const data = await res.json();
  jwksCache = { url: certsUrl, keys: data.keys || [], exp: now + 3600 * 1000 };
  return jwksCache.keys;
}

/**
 * Verify the Cloudflare Access JWT on a request.
 * @returns {{ configured:boolean, ok:boolean, email?:string, reason?:string }}
 */
export async function verifyAccess(request, env) {
  const cfg = accessConfig(env);
  if (!cfg.configured) return { configured: false, ok: false };

  const token = getToken(request);
  if (!token) return { configured: true, ok: false, reason: "no-token" };

  const parts = token.split(".");
  if (parts.length !== 3) return { configured: true, ok: false, reason: "malformed" };

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return { configured: true, ok: false, reason: "decode" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { configured: true, ok: false, reason: "expired" };
  if (payload.nbf && payload.nbf > now + 60) return { configured: true, ok: false, reason: "nbf" };
  if (String(payload.iss || "").replace(/\/$/, "") !== cfg.teamDomain)
    return { configured: true, ok: false, reason: "iss" };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(cfg.aud)) return { configured: true, ok: false, reason: "aud" };

  try {
    const keys = await getKeys(cfg.certsUrl);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return { configured: true, ok: false, reason: "unknown-kid" };
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!valid) return { configured: true, ok: false, reason: "bad-signature" };
  } catch {
    return { configured: true, ok: false, reason: "verify-error" };
  }

  return {
    configured: true,
    ok: true,
    email: payload.email || payload.identity || payload.sub || "",
  };
}
