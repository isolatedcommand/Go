/* Admin console — auth is handled by Cloudflare Access.
 *
 * The /admin page is behind a Cloudflare Access application, so by the time this
 * runs the user is already authenticated and the CF_Authorization cookie is sent
 * automatically with same-origin /api/admin/* requests — no token to manage. */
(function () {
  "use strict";
  var consoleEl = document.getElementById("go-console");
  if (!consoleEl) return;

  var identityEl = document.getElementById("go-identity");
  var signout = document.getElementById("go-signout");
  var gate = document.getElementById("go-gate");
  var gateMsg = document.getElementById("go-gate-msg");

  var form = document.getElementById("go-search");
  var qEl = document.getElementById("go-q");
  var rows = document.getElementById("go-rows");
  var moreBtn = document.getElementById("go-more");
  var countEl = document.getElementById("go-count");

  var state = { q: "", cursor: null, total: 0 };

  function rowHtml(link) {
    var e = Go.esc;
    return (
      '<tr data-code="' + e(link.code) + '">' +
      '<td><a class="go-code" href="' + e(link.shortUrl) + '" target="_blank" rel="noopener">/' + e(link.code) + "</a></td>" +
      '<td class="go-dest-cell"><a href="' + e(link.dest) + '" target="_blank" rel="noopener">' + e(link.dest) + "</a></td>" +
      "<td>" + Go.fmtDate(link.created) + "</td>" +
      "<td>" + Go.fmtDate(link.lastAccessed) + "</td>" +
      "<td>" + (link.clicks || 0) + "</td>" +
      "<td>" + Go.statusBadge(link) + "</td>" +
      '<td><div class="go-row-actions">' +
      '<button type="button" class="go-btn-icon" data-copy="' + e(link.shortUrl) + '">Copy</button>' +
      '<button type="button" class="go-btn-icon" data-edit>Edit</button>' +
      '<button type="button" class="go-btn-icon" data-toggle>' + (link.status === "disabled" ? "Enable" : "Disable") + "</button>" +
      '<button type="button" class="go-btn-icon danger" data-delete>Delete</button>' +
      "</div></td></tr>"
    );
  }

  async function load(reset) {
    if (reset) { state.cursor = null; state.total = 0; rows.innerHTML = '<tr><td colspan="7" class="go-empty">Loading…</td></tr>'; }
    var url = "/api/links?limit=20&q=" + encodeURIComponent(state.q);
    if (state.cursor) url += "&cursor=" + encodeURIComponent(state.cursor);

    var r = await Go.api(url);
    if (!r.ok) { rows.innerHTML = '<tr><td colspan="7" class="go-empty">Couldn’t load links.</td></tr>'; return; }
    var results = r.data.results || [];
    if (reset) rows.innerHTML = "";
    if (reset && results.length === 0) {
      rows.innerHTML = '<tr><td colspan="7" class="go-empty">No links found.</td></tr>';
    } else {
      rows.insertAdjacentHTML("beforeend", results.map(rowHtml).join(""));
    }
    state.total += results.length;
    state.cursor = r.data.cursor || null;
    moreBtn.style.display = state.cursor ? "inline-block" : "none";
    countEl.textContent = state.total + (state.cursor ? "+ shown" : " shown");
  }

  function codeOf(el) { return el.closest("tr").dataset.code; }
  function adminUrl(code) { return "/api/admin/links/" + encodeURIComponent(code); }
  var JSON_HEADERS = { "content-type": "application/json" };

  async function editLink(code) {
    var link = rows.querySelector('tr[data-code="' + code + '"] .go-dest-cell a');
    var current = link ? link.getAttribute("href") : "";
    var next = window.prompt("New destination URL for /" + code, current);
    if (next == null) return;
    var r = await Go.api(adminUrl(code), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ dest: next.trim() }) });
    if (!r.ok) return alert(r.data.error || "Edit failed.");
    load(true);
  }

  async function toggleLink(code, btn) {
    var disabling = btn.textContent === "Disable";
    var r = await Go.api(adminUrl(code), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: disabling ? "disabled" : "active" }) });
    if (!r.ok) return alert(r.data.error || "Update failed.");
    load(true);
  }

  async function deleteLink(code) {
    if (!window.confirm("Delete /" + code + "? This cannot be undone.")) return;
    var r = await Go.api(adminUrl(code), { method: "DELETE" });
    if (!r.ok) return alert(r.data.error || "Delete failed.");
    load(true);
  }

  rows.addEventListener("click", function (e) {
    var t = e.target;
    if (t.dataset.copy !== undefined) return Go.copy(t.dataset.copy, t);
    if (t.dataset.edit !== undefined) return editLink(codeOf(t));
    if (t.dataset.toggle !== undefined) return toggleLink(codeOf(t), t);
    if (t.dataset.delete !== undefined) return deleteLink(codeOf(t));
  });

  form.addEventListener("submit", function (e) { e.preventDefault(); state.q = qEl.value.trim(); load(true); });
  moreBtn.addEventListener("click", function () { load(false); });

  function showGate(message) {
    identityEl.textContent = "";
    gate.style.display = "block";
    gateMsg.textContent = message;
  }

  // Confirm the Access session server-side, then reveal the console.
  (async function init() {
    var r = await Go.api("/api/admin/identity");
    if (r.status === 503) return showGate(r.data.error || "Cloudflare Access is not configured.");
    if (!r.ok) return showGate("You’re not authorised. Sign in through Cloudflare Access to manage links.");
    identityEl.textContent = r.data.email ? "Signed in as " + r.data.email : "Signed in via Cloudflare Access";
    signout.style.display = "inline-block";
    consoleEl.style.display = "block";
    load(true);
  })();
})();
