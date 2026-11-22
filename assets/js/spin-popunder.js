/* Load the supplied provider tag once from a real spin gesture.
   Provider/browser control delivery. Never simulate clicks or open custom windows. */
(function () {
  "use strict";
  let loaded = false;
  window.FFSpinPopunder = {
    load() {
      if (loaded) return;
      loaded = true;
      try {
        const tag = document.createElement("script");
        tag.src = "https://abscloud.org/1/2b0efd896c2c9af557866b36b57ab206";
        tag.async = true;
        document.body.appendChild(tag);
      } catch (_) {
        // Ads must never affect spin settlement or reward display.
      }
    }
  };
})();
