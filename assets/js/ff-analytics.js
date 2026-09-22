/* FlexFam analytics — Supabase-backed and intentionally dependency-free.
   Using the REST endpoint directly avoids downloading/parsing the Supabase
   SDK on every visitor page, which keeps Chrome scrolling responsive. */
(function () {
  "use strict";

  var cfg = window.FF_SUPABASE_CONFIG || null;
  var enabled = !!(cfg && cfg.url && cfg.anonKey &&
    !String(cfg.url).includes("your-project") && !String(cfg.anonKey).includes("your-anon"));
  var queue = [];
  var flushing = false;
  var baseUrl = enabled ? String(cfg.url).replace(/\/+$/, "") + "/rest/v1/" : "";

  /* Who is doing this? Anonymous visitors stay anonymous (vid only); a
     logged-in member's email is attached so the admin panel can show the
     actual person behind each event instead of an opaque visitor id. */
  function actor() {
    try {
      var email = JSON.parse(localStorage.getItem("ff_session") || "null");
      if (!email || typeof email !== "string") return { email: null, name: null };
      var users = JSON.parse(localStorage.getItem("ff_users") || "[]");
      var me = null;
      for (var i = 0; i < users.length; i++) {
        if (users[i] && users[i].email === email) { me = users[i]; break; }
      }
      return { email: String(email).slice(0, 160), name: me && me.name ? String(me.name).slice(0, 80) : null };
    } catch (e) {
      return { email: null, name: null };
    }
  }

  function visitorId() {
    try {
      var value = localStorage.getItem("ff_vid");
      if (!value) {
        value = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("ff_vid", value);
      }
      return value;
    } catch (e) {
      return "v-anon";
    }
  }

  function event(type, data) {
    data = data || {};
    /* Keep the payload in sync with supabase.sql. Do not spread arbitrary
       browser data into a PostgREST insert: unknown columns reject a batch. */
    var who = actor();
    return {
      type: String(type || "event").slice(0, 80),
      email: who.email,
      user_name: who.name,
      page: (location.pathname.split("/").pop() || "index.html").slice(0, 160),
      path: String(location.pathname || "").slice(0, 400),
      title: String(document.title || "").slice(0, 140),
      ref: String(document.referrer || "").slice(0, 400),
      vid: visitorId(),
      lang: String(navigator.language || "").slice(0, 20),
      ua: String(navigator.userAgent || "").slice(0, 220),
      day: new Date().toISOString().slice(0, 10),
      ts_client: new Date().toISOString(),
      url: data.url ? String(data.url).slice(0, 400) : null,
      label: data.label ? String(data.label).slice(0, 120) : null,
      task_title: (data.taskTitle || data.task_title) ? String(data.taskTitle || data.task_title).slice(0, 120) : null,
      task_id: (data.taskId || data.task_id) ? String(data.taskId || data.task_id).slice(0, 120) : null,
      payout: Number.isFinite(Number(data.payout)) ? Number(data.payout) : null,
    };
  }

  function request(table, rows, keepalive) {
    return fetch(baseUrl + table, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: "Bearer " + cfg.anonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
      keepalive: !!keepalive,
    }).then(function (response) {
      if (!response.ok) throw new Error("Analytics request failed: " + response.status);
    });
  }

  function flush(keepalive) {
    if (!enabled || flushing || !queue.length) return;
    flushing = true;
    var pending = queue.splice(0, queue.length);
    var groups = {};
    pending.forEach(function (entry) {
      (groups[entry.table] = groups[entry.table] || []).push(entry.row);
    });
    Promise.all(Object.keys(groups).map(function (table) {
      return request(table, groups[table], keepalive).catch(function () {
        /* Analytics must never slow down or interrupt a member action. */
      });
    })).finally(function () {
      flushing = false;
      if (queue.length) flush(false);
    });
  }

  function enqueue(table, row) {
    if (!enabled) return;
    queue.push({ table: table, row: row });
    /* Batch same-tick events without blocking page interaction or rendering. */
    if (queue.length === 1) setTimeout(function () { flush(false); }, 0);
  }

  function track(type, data) {
    enqueue("events", event(type, data));
  }

  function saveCampaign(campaign) {
    campaign = campaign || {};
    enqueue("campaigns", {
      campaign_id: String(campaign.id || "").slice(0, 120),
      platform: String(campaign.platform || "").slice(0, 50),
      action: String(campaign.action || "").slice(0, 80),
      title: String(campaign.title || "").slice(0, 120),
      url: String(campaign.url || "").slice(0, 400),
      payout: Number(campaign.payout || 0),
      owner: visitorId(),
      source: "web",
      day: new Date().toISOString().slice(0, 10),
      ts_client: new Date().toISOString(),
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    track("page_view");
  });
  document.addEventListener("click", function (e) {
    var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    track(href.indexOf("t.me/sub_for_sub_bot") !== -1 ? "telegram_bot_click" : "link_click", {
      url: href,
      label: (link.textContent || "").trim(),
    });
  }, true);
  window.addEventListener("pagehide", function () { flush(true); }, { passive: true });

  window.FFA = {
    track: track,
    actor: actor,
    saveCampaign: saveCampaign,
    visitorId: visitorId,
    get enabled() { return enabled; },
  };
})();
