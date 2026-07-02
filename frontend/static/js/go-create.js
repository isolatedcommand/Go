/* Home page — the big editable go.isolatedcommand.com/<code> builder + live stats. */
(function () {
  "use strict";

  // ---- Animated stat counters (from /api/stats) ----
  (function stats() {
    var nums = document.querySelectorAll(".go-stat-num[data-stat]");
    if (!nums.length) return;
    function animate(el, target) {
      var start = 0, dur = 1100, t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(start + (target - start) * eased).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    Go.api("/api/stats").then(function (r) {
      if (!r.ok) { nums.forEach(function (n) { n.textContent = "—"; }); return; }
      nums.forEach(function (n) {
        var v = Number(r.data[n.getAttribute("data-stat")] || 0);
        animate(n, v);
      });
    });
  })();

  var form = document.getElementById("go-create");
  if (!form) return;

  var codeEl = document.getElementById("go-code");
  var destEl = document.getElementById("go-dest");
  var submit = document.getElementById("go-submit");
  var msg = document.getElementById("go-msg");
  var result = document.getElementById("go-result");
  var resultLink = document.getElementById("go-result-link");
  var copyBtn = document.getElementById("go-result-copy");
  var openBtn = document.getElementById("go-result-open");

  // Keep the editable code clean as the user types (letters, numbers, - . _ ~).
  codeEl.addEventListener("input", function () {
    var cleaned = codeEl.value.replace(/^\/+/, "").replace(/[^A-Za-z0-9._~-]/g, "");
    if (cleaned !== codeEl.value) codeEl.value = cleaned;
  });

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.className = "go-create-msg" + (kind ? " is-" + kind : "");
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    result.classList.remove("show");
    setMsg("Shortening…", "");
    submit.disabled = true;

    try {
      var r = await Go.api("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: codeEl.value.trim(), dest: destEl.value.trim() }),
      });
      if (!r.ok) {
        setMsg(r.data.error || "Something went wrong. Please try again.", "error");
        return;
      }
      var link = r.data.link;
      setMsg("Your short link is ready.", "ok");
      resultLink.textContent = link.shortUrl;
      resultLink.href = link.shortUrl;
      result.classList.add("show");
      codeEl.value = "";
      destEl.value = "";
    } catch (err) {
      setMsg("Network error — please try again.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  copyBtn.addEventListener("click", function () {
    Go.copy(resultLink.textContent, copyBtn);
  });
  openBtn.addEventListener("click", function () {
    window.open(resultLink.href, "_blank", "noopener");
  });
})();
