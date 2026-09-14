/* ============================================================
   FLEXFAM — Firestore analytics tracker (public visitors)

   • Loads Firebase Web SDK (ESM, from gstatic CDN) lazily.
   • Reads config from window.FF_FIREBASE_CONFIG
     (assets/js/firebase-config.js — gitignored; see
     assets/js/firebase-config.example.js).
   • If config is missing / still a placeholder → silently no-ops,
     so the site keeps working without Firebase too.

   Events written to the `events` collection (create-only for the
   public; readable only by the admin — see firestore.rules):
     page_view, link_click, telegram_bot_click,
     task_open, task_claim, campaign_created
   ============================================================ */

(function () {
  "use strict";

  var SDK = "https://www.gstatic.com/firebasejs/10.12.5/";
  var BOT_URL_MARK = "t.me/sub_for_sub_bot";

  var cfg = window.FF_FIREBASE_CONFIG || null;
  var enabled = !!(
    cfg &&
    cfg.apiKey &&
    cfg.projectId &&
    cfg.apiKey.indexOf("PASTE_") === -1 &&
    cfg.projectId.indexOf("your-project") === -1
  );

  var queue = [];
  var fb = null; // { db, addDoc, collection, serverTimestamp }
  var loading = false;

  /* ---------- anonymous visitor id (for unique-visitor approx) ---------- */
  function visitorId() {
    try {
      var v = localStorage.getItem("ff_vid");
      if (!v) {
        v = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("ff_vid", v);
      }
      return v;
    } catch (e) {
      return "v-anon";
    }
  }

  /* ---------- SDK bootstrap ---------- */
  function ensureSdk() {
    if (fb || loading || !enabled) return;
    loading = true;
    Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-firestore.js")])
      .then(function (mods) {
        var appMod = mods[0];
        var fsMod = mods[1];
        var app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
        fb = {
          db: fsMod.getFirestore(app),
          addDoc: fsMod.addDoc,
          collection: fsMod.collection,
          serverTimestamp: fsMod.serverTimestamp,
        };
        flush();
      })
      .catch(function () {
        enabled = false;
        queue.length = 0;
      });
  }

  function buildEvent(type, data) {
    var ev = {
      type: type,
      page: location.pathname.split("/").pop() || "index.html",
      path: location.pathname,
      title: (document.title || "").slice(0, 140),
      ref: (document.referrer || "").slice(0, 400),
      vid: visitorId(),
      lang: (navigator.language || "").slice(0, 20),
      ua: (navigator.userAgent || "").slice(0, 220),
      day: new Date().toISOString().slice(0, 10),
      tsClient: Date.now(),
    };
    if (data) {
      for (var k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined && data[k] !== null) {
          ev[k] = data[k];
        }
      }
    }
    return ev;
  }

  function writeDoc(col, doc) {
    try {
      doc.ts = fb.serverTimestamp();
      fb.addDoc(fb.collection(fb.db, col), doc).catch(function () {});
    } catch (e) {
      /* analytics must never break the site */
    }
  }

  function flush() {
    if (!fb) return;
    while (queue.length) {
      var item = queue.shift();
      writeDoc(item.col, item.doc);
    }
  }

  /* ---------- public API ---------- */
  function track(type, data) {
    if (!enabled) return;
    queue.push({ col: "events", doc: buildEvent(type, data) });
    fb ? flush() : ensureSdk();
  }

  /* migration-ready: mirror campaigns into their own collection */
  function saveCampaign(camp) {
    if (!enabled) return;
    queue.push({
      col: "campaigns",
      doc: {
        campaignId: String(camp.id || ""),
        platform: String(camp.platform || ""),
        action: String(camp.action || ""),
        title: String(camp.title || "").slice(0, 120),
        url: String(camp.url || "").slice(0, 400),
        payout: Number(camp.payout || 0),
        owner: visitorId(),
        source: "web",
        day: new Date().toISOString().slice(0, 10),
        tsClient: Date.now(),
      },
    });
    fb ? flush() : ensureSdk();
  }

  /* ---------- automatic events ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    track("page_view");
  });

  /* external link clicks + special-case the FlexFam Telegram bot link */
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) return;
      var label = (a.textContent || "").trim().slice(0, 80);
      if (href.indexOf(BOT_URL_MARK) !== -1) {
        track("telegram_bot_click", { url: href.slice(0, 400), label: label });
      } else {
        track("link_click", { url: href.slice(0, 400), label: label });
      }
    },
    true
  );

  window.FFA = {
    track: track,
    saveCampaign: saveCampaign,
    visitorId: visitorId,
    get enabled() {
      return enabled;
    },
  };
})();
