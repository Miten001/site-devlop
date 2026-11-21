/* Keep referral signup safe even when the shared engine fails to download. */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    var engine = window.FF;
    var form = document.getElementById("signup-form");
    if (!engine || typeof engine.captureRefCode !== "function") {
      var message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = "Signup could not load. Please reload the page. If it keeps failing, check your connection or content blocker.";
      if (form) {
        // Never let a broken JS form submit passwords in a URL query string.
        form.addEventListener("submit", function (event) { event.preventDefault(); });
        form.querySelectorAll("button").forEach(function (button) { button.disabled = true; });
        form.before(message);
      }
      var demo = document.getElementById("demo-login");
      if (demo) demo.disabled = true;
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-ghost";
      retry.textContent = "Reload signup";
      retry.addEventListener("click", function () { window.location.reload(); });
      message.appendChild(retry);
      return;
    }
    var code = engine.captureRefCode();
    if (!code) return;
    document.getElementById("ref-hint-code").textContent = code;
    document.getElementById("ref-hint").classList.remove("hidden");
  });
})();
