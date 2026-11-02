/* FlexFam — real site-wide counters beside the existing daily counters.
   Server aggregates only: never substitute demo/browser activity for site data.
   SQL: supabase-site-stats.sql (site_stats). The old site_today_stats RPC
   remains a daily-only fallback until that migration is installed. */
(function () {
  "use strict";

  var FF = window.FF;
  if (!FF) return;

  var FIELDS = {
    visitors_today: "site-visitors",
    registered_today: "site-registered",
    total_views: "site-total-views",
    total_registered: "site-total-registered",
    running_tasks: "site-running-tasks",
    completed_tasks: "site-completed-tasks"
  };
  var REFRESH_MS = 60000;
  var pending = false;
  var legacyMode = false;
  var loaded = false;
  var requestNumber = 0;
  var panel, button, status, note;

  function count(value) {
    if (value == null || value === "") return null;
    var n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  function normalize(payload, legacy) {
    var row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || typeof row !== "object") return null;
    var result = {};
    Object.keys(FIELDS).forEach(function (key) { result[key] = null; });
    result.visitors_today = count(legacy ? row.visitors : row.visitors_today);
    result.registered_today = count(legacy ? row.registered : row.registered_today);
    if (!legacy) {
      Object.keys(FIELDS).slice(2).forEach(function (key) {
        result[key] = count(row[key]);
      });
    }
    return result;
  }

  function paint(stats) {
    Object.keys(FIELDS).forEach(function (key) {
      var el = document.getElementById(FIELDS[key]);
      if (!el) return;
      var label = stats && stats[key] != null
        ? stats[key].toLocaleString("en-IN") : "—";
      el.textContent = label;
      // Keep large lifetime totals on one line even on narrow phones.
      el.classList.toggle("site-stat-long", label.length > 9 && label.length <= 12);
      el.classList.toggle("site-stat-extra-long", label.length > 12);
    });
  }

  function state(label, message, kind) {
    status.textContent = label;
    status.className = "status-pill " + (kind === "live" ? "on" : "off");
    // Setup/migration instructions belong in the runbook, not the member UI.
    // Keep this live region for actionable connection/account errors only.
    note.textContent = message || "";
    note.hidden = !message;
    panel.dataset.state = kind;
  }

  function unavailable(message, kind) {
    // Keep the last successful snapshot, but clearly label it as stale.
    if (!loaded) paint(null);
    state(loaded ? "Last snapshot" : "Unavailable", message, kind || "error");
  }

  function load() {
    if (!panel || pending) return Promise.resolve();
    if (!FF.hasServer || !FF.hasServer()) {
      loaded = false;
      unavailable("Sign in with your server account to see site-wide counts. Demo and browser-only activity are not included.", "offline");
      return Promise.resolve();
    }

    pending = true;
    var requestId = ++requestNumber;
    button.disabled = true;
    button.textContent = "Refreshing…";
    panel.setAttribute("aria-busy", "true");

    var promise;
    try {
      promise = legacyMode
        ? FF.rpc("site_today_stats").then(function (data) { return { stats: normalize(data, true), legacy: true }; })
        : FF.rpc("site_stats").then(function (data) { return { stats: normalize(data, false), legacy: false }; })
          .catch(function (err) {
            var message = String(err && err.message || "");
            var missingRpc = err && (err.status === 404 || err.code === "PGRST202");
            missingRpc = missingRpc || /PGRST202|Could not find the function|Request failed \(404\)/i.test(message);
            if ((err && err.offline) || !missingRpc) throw err;
            // Missing SQL must not break the two existing daily counters.
            // Other server errors stay errors instead of being labelled
            // "migration needed". Never turn a failure into zero.
            return FF.rpc("site_today_stats").then(function (data) {
              legacyMode = true;
              return { stats: normalize(data, true), legacy: true };
            });
          });
    } catch (err) {
      promise = Promise.reject(err);
    }

    return promise.then(function (result) {
      if (requestId !== requestNumber) return;
      if (!result.stats || !Object.keys(FIELDS).some(function (key) { return result.stats[key] != null; })) {
        throw new Error("Invalid site statistics response");
      }
      loaded = true;
      paint(result.stats);
      var complete = Object.keys(FIELDS).every(function (key) { return result.stats[key] != null; });
      if (result.legacy) {
        state("Daily only", "", "partial");
      } else if (!complete) {
        state("Partial data", "", "partial");
      } else {
        state("Live data", "Updated " + new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) + " · Refreshes every minute while this page is visible.", "live");
      }
    }).catch(function () {
      if (requestId !== requestNumber) return;
      unavailable(loaded
        ? "Couldn’t refresh site counts. Showing the last loaded snapshot; try Refresh."
        : "Couldn’t load site counts. Check your connection and try Refresh.", "error");
    }).finally(function () {
      if (requestId !== requestNumber) return;
      pending = false;
      button.disabled = false;
      button.textContent = "↻ Refresh";
      panel.setAttribute("aria-busy", "false");
    });
  }

  function boot() {
    panel = document.getElementById("site-stats-panel");
    if (!panel) return;
    button = document.getElementById("site-stats-refresh");
    status = document.getElementById("site-stats-status");
    note = document.getElementById("site-stats-note");
    button.addEventListener("click", load);
    load();
    setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) load();
    });
    // Campaign pause/resume/delete and proof reviews already sync this feed.
    // Refresh the aggregate after those actions without counting local rows.
    document.addEventListener("ff:campaigns-synced", function () {
      if (!document.hidden) load();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
