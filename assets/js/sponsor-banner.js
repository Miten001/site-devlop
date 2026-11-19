/* Choose one banner size. No hidden second placement or periodic refresh. */
(function () {
  "use strict";
  const frame = document.querySelector("[data-sponsor-frame]");
  if (!frame) return;
  const desktop = window.matchMedia("(min-width: 768px)");
  function update() {
    const src = desktop.matches ? "assets/adsterra-desktop.html" : "assets/adsterra-banner.html";
    if (frame.getAttribute("src") === src) return;
    frame.width = desktop.matches ? "728" : "320";
    frame.height = desktop.matches ? "90" : "50";
    frame.src = src;
  }
  update();
  if (desktop.addEventListener) desktop.addEventListener("change", update);
  else if (desktop.addListener) desktop.addListener(update);
})();
