/* Interstitial countdown: waits N seconds, then sends the visitor on.
 * All values come from the #go-redirect data-* attributes, which the Worker
 * fills in with the real link details before serving this page. */
(function () {
  "use strict";
  var el = document.getElementById("go-redirect");
  if (!el) return;

  var to = el.getAttribute("data-to") || "";
  // Only ever redirect to http(s) — destinations are validated at creation,
  // this is a final client-side guard.
  if (!/^https?:\/\//i.test(to)) return;

  var wait = parseInt(el.getAttribute("data-wait"), 10);
  if (!wait || wait < 1) wait = 5;

  var numEl = document.getElementById("go-count");
  var wordEl = document.getElementById("go-count-word");
  var ring = document.getElementById("go-ring-fill");

  // Animate the SVG ring from full to empty over the wait period.
  if (ring) {
    var len = 2 * Math.PI * 52;
    ring.style.strokeDasharray = len;
    ring.style.strokeDashoffset = "0";
    ring.style.transition = "stroke-dashoffset " + wait + "s linear";
    requestAnimationFrame(function () { ring.style.strokeDashoffset = len; });
  }

  var remaining = wait;
  var timer = setInterval(function () {
    remaining -= 1;
    var shown = Math.max(remaining, 0);
    if (numEl) numEl.textContent = shown;
    if (wordEl) wordEl.textContent = shown;
    if (remaining <= 0) {
      clearInterval(timer);
      window.location.replace(to);
    }
  }, 1000);

  // "Continue now" skips the wait.
  var now = document.getElementById("go-now");
  if (now) now.addEventListener("click", function (e) {
    e.preventDefault();
    clearInterval(timer);
    window.location.replace(to);
  });
})();
