/* FlexFam — notification bell (Round-35)
   Header me 🔔: credit notifications + admin broadcasts / DMs.
   Data: supabase-notifications.sql (bell_feed / bell_mark_read).
   Depends on: main.js (FF.rpc, FF.currentUser, FF.hasServer). */
(function () {
  if (!window.FF) return;

  var OPEN = false, LAST = null;
  var ICON = { credit: "💰", broadcast: "📢", dm: "✉️", system: "⚙️" };
  var LABEL = { credit: "Reward", broadcast: "Announcement", dm: "Message", system: "Notice" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function ago(t) {
    var d = Date.now() - Number(t || 0);
    if (!(d > 0)) return "just now";
    var m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var dd = Math.floor(h / 24);
    return dd === 1 ? "yesterday" : dd + "d ago";
  }

  function boot() {
    try {
      if (!FF.currentUser() || !FF.hasServer || !FF.hasServer()) return;
    } catch (e) { return; }
    var host = document.querySelector(".head-actions");
    if (!host || document.getElementById("ff-bell")) return;

    var btn = document.createElement("button");
    btn.id = "ff-bell";
    btn.type = "button";
    btn.className = "bell-btn";
    btn.setAttribute("aria-label", "Notifications");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
      '<span class="bell-badge" id="ff-bell-badge" hidden>0</span>';
    host.insertBefore(btn, host.firstChild);

    var panel = document.createElement("div");
    panel.id = "ff-bell-panel";
    panel.className = "bell-panel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="bell-head"><b>Notifications</b>' +
      '<button type="button" class="bell-clear" id="ff-bell-clear" hidden>✓ Mark all read</button></div>' +
      '<div class="bell-list" id="ff-bell-list"><div class="bell-empty">Loading…</div></div>';
    document.body.appendChild(panel);

    btn.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.getElementById("ff-bell-clear").addEventListener("click", markAll);
    document.addEventListener("click", function (e) {
      if (OPEN && e.target !== btn && !btn.contains(e.target)) close();
    });
    window.addEventListener("resize", function () { if (OPEN) position(); });

    load();
    setInterval(load, 45000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
  }

  function toggle() { if (OPEN) close(); else open(); }
  function open() {
    OPEN = true;
    position();
    var panel = document.getElementById("ff-bell-panel");
    panel.hidden = false;
    requestAnimationFrame(function () { panel.classList.add("open"); });
    load();
  }
  function close() {
    OPEN = false;
    var panel = document.getElementById("ff-bell-panel");
    if (!panel) return;
    panel.classList.remove("open");
    setTimeout(function () { if (!OPEN) panel.hidden = true; }, 200);
  }
  function position() {
    var btn = document.getElementById("ff-bell"), panel = document.getElementById("ff-bell-panel");
    if (!btn || !panel) return;
    var r = btn.getBoundingClientRect();
    var w = Math.min(360, window.innerWidth - 20);
    panel.style.width = w + "px";
    panel.style.left = Math.max(10, Math.min(r.right - w, window.innerWidth - w - 10)) + "px";
    panel.style.top = (r.bottom + 10) + "px";
  }

  function load() {
    FF.rpc("bell_feed").then(function (d) {
      if (!d || !d.items) return;
      LAST = d;
      render(d);
    }).catch(function () { /* SQL not run / offline — bell stays quiet */ });
  }

  function render(d) {
    var list = document.getElementById("ff-bell-list"), badge = document.getElementById("ff-bell-badge");
    if (!list) return;
    var n = Number(d.unread || 0);
    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? "99+" : String(n);
      if (n > 0) { badge.classList.remove("pop"); void badge.offsetWidth; badge.classList.add("pop"); }
    }
    var clearBtn = document.getElementById("ff-bell-clear");
    if (clearBtn) clearBtn.hidden = n === 0;
    var items = d.items || [];
    if (!items.length) {
      list.innerHTML = '<div class="bell-empty">🔔 Nothing yet — credits and announcements will land here.</div>';
      return;
    }
    list.innerHTML = items.map(function (it) {
      return '<div class="bell-item' + (it.read ? "" : " unread") + '">' +
        '<span class="bi-ico">' + (ICON[it.kind] || "🔔") + "</span>" +
        '<span class="bi-main"><span class="bi-kind">' + (LABEL[it.kind] || "Notice") + " · " + ago(it.at) + "</span>" +
        '<b class="bi-title">' + esc(it.title || "Update") + "</b>" +
        '<span class="bi-body">' + esc(it.body || "") + "</span></span>" +
        (it.read ? "" : '<span class="bi-dot"></span>') +
        "</div>";
    }).join("");
  }

  function markAll() {
    if (!LAST || !LAST.items) return;
    var ids = LAST.items.filter(function (i) { return !i.read; }).map(function (i) { return i.id; });
    if (!ids.length) return;
    FF.rpc("bell_mark_read", { p_ids: ids }).then(load).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
