/* Parser-time banner placement: provider tag runs in the host page, not a wrapper iframe.
   Keep this script synchronous inside the footer slot (no async/defer).
   Select one size per page view; never refresh ads on resize or spin. */
(function () {
  "use strict";
  if (document.readyState !== "loading" || window.ffSponsorBannerLoaded) return;
  window.ffSponsorBannerLoaded = true;
  const slot = document.currentScript && document.currentScript.closest(".ff-sponsor-banner");
  const desktop = window.innerWidth >= 768;
  const width = desktop ? 728 : 320;
  const height = desktop ? 90 : 50;
  const key = desktop ? "34fa5d9809139649a8e23ae1163302d5" : "7045db5b55efe3ba5a0a1e3dc34ebff1";
  if (slot) {
    slot.style.maxWidth = width + "px";
    slot.style.setProperty("--banner-width", width + "px");
    slot.style.setProperty("--banner-height", height + "px");
  }
  window.atOptions = { key: key, format: "iframe", height: height, width: width, params: {} };
  // The provider's format:'iframe' is retained. Only our extra hosting iframe is removed.
  document.write('<script src="https://bauval.org/22/' + key + '"><\/script>');
})();
