/* Home page — the big editable go.isolatedcommand.com/<code> builder. */
(function () {
  "use strict";
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
