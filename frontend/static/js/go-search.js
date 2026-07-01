/* Search page — reads links from the KV-backed API with pagination. */
(function () {
  "use strict";
  var rows = document.getElementById("go-rows");
  if (!rows) return;

  var form = document.getElementById("go-search");
  var qEl = document.getElementById("go-q");
  var moreBtn = document.getElementById("go-more");
  var countEl = document.getElementById("go-count");

  var state = { q: "", cursor: null, total: 0 };

  function rowHtml(link) {
    var e = Go.esc;
    return (
      "<tr>" +
      '<td><a class="go-code" href="' + e(link.shortUrl) + '" target="_blank" rel="noopener">/' + e(link.code.replace(/^\//, "")) + "</a></td>" +
      '<td class="go-dest-cell"><a href="' + e(link.dest) + '" target="_blank" rel="noopener">' + e(link.dest) + "</a></td>" +
      "<td>" + Go.fmtDate(link.created) + "</td>" +
      "<td>" + (link.clicks || 0) + "</td>" +
      "<td>" + Go.statusBadge(link) + "</td>" +
      '<td><div class="go-row-actions">' +
      '<button type="button" class="go-btn-icon" data-copy="' + e(link.shortUrl) + '">Copy</button>' +
      '<button type="button" class="go-btn-icon" data-open="' + e(link.shortUrl) + '">Open</button>' +
      "</div></td></tr>"
    );
  }

  async function load(reset) {
    if (reset) {
      state.cursor = null;
      state.total = 0;
      rows.innerHTML = '<tr><td colspan="6" class="go-empty">Loading links…</td></tr>';
    }
    var url = "/api/links?limit=20&q=" + encodeURIComponent(state.q);
    if (state.cursor) url += "&cursor=" + encodeURIComponent(state.cursor);

    var r = await Go.api(url);
    if (!r.ok) {
      rows.innerHTML = '<tr><td colspan="6" class="go-empty">Couldn’t load links.</td></tr>';
      return;
    }
    var results = r.data.results || [];
    if (reset) rows.innerHTML = "";
    if (reset && results.length === 0) {
      rows.innerHTML = '<tr><td colspan="6" class="go-empty">No links found' + (state.q ? " for “" + Go.esc(state.q) + "”." : ".") + "</td></tr>";
    } else {
      rows.insertAdjacentHTML("beforeend", results.map(rowHtml).join(""));
    }
    state.total += results.length;
    state.cursor = r.data.cursor || null;
    moreBtn.style.display = state.cursor ? "inline-block" : "none";
    countEl.textContent = state.total + (state.cursor ? "+ shown" : " shown");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    state.q = qEl.value.trim();
    load(true);
  });
  moreBtn.addEventListener("click", function () { load(false); });

  rows.addEventListener("click", function (e) {
    var t = e.target;
    if (t.dataset.copy) Go.copy(t.dataset.copy, t);
    else if (t.dataset.open) window.open(t.dataset.open, "_blank", "noopener");
  });

  load(true);
})();
