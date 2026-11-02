/* =========================================================================
   FlexFam — FULL MESSAGE viewer ("tap to read")
   -------------------------------------------------------------------------
   Problem: notification bell / inbox / support box me message 2-3 lines me
   cut ho jaata tha aur poora padhne ka koi rasta nahi tha.

   Ab har message card `data-msg-id` ke saath clickable (aur keyboard se
   Enter/Space par bhi) hota hai. Tap karte hi ek bada modal khulta hai jisme
   **poora** message, title, kaun bheja, audience aur date — full size me,
   line breaks ke saath dikhta hai. Long links / bade words bhi wrap hote
   hain; koi ellipsis / clipping nahi.

   Standalone: kisi FF / Supabase API par dependency nahi. Har page par
   `assets/js/bell.js` se pehle load hota hai, isliye admin.html (jahan FF
   nahi hai) me bhi kaam karta hai.
   ========================================================================= */
(function () {
  "use strict";

  var registry = {};
  var order = [];
  var seq = 0;
  var veil = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function fmtDate(t) {
    var n = Number(t || 0);
    if (!n || !isFinite(n)) return "";
    try { return new Date(n).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return ""; }
  }
  function clip(s, n) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > (n || 140) ? t.slice(0, n) + "…" : t;
  }
  /* Newlines preserve + links clickable, lekin hamesha escaped (XSS-safe). */
  function rich(text) {
    var src = String(text == null ? "" : text), out = "", last = 0, m;
    var re = /https?:\/\/[^\s]+/gi;
    while ((m = re.exec(src)) !== null) {
      var url = m[0], tail = "";
      /* trailing punctuation link ka hissa nahi hai */
      while (/[.,;:!?)\]]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
      out += esc(src.slice(last, m.index));
      out += '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a>" + esc(tail);
      last = m.index + m[0].length;
    }
    out += esc(src.slice(last));
    return out.replace(/\n/g, "<br>");
  }

  function ensureStyles() {
    if (!document || !document.head || document.getElementById("ffm-style")) return;
    var st = document.createElement("style");
    st.id = "ffm-style";
    st.textContent = [
      /* full-message modal */
      ".ffm-card{width:min(620px,100%);text-align:left}",
      ".ffm-kind{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--blue,#2f6fed);background:rgba(47,111,237,.08);border:1px solid rgba(47,111,237,.2);border-radius:999px;padding:4px 10px;margin:2px 40px 10px 0}",
      ".ffm-title{margin:0 40px 6px 0;font-size:19px;line-height:1.35;overflow-wrap:anywhere}",
      ".ffm-meta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:11.5px;color:var(--ink-mute,#626d80);margin-bottom:14px}",
      ".ffm-meta .sep{color:var(--line-2,#ccc)}",
      ".ffm-body{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:15px;line-height:1.75;color:var(--ink,#1b2330);background:var(--bg-3,#eef1f6);border:1px solid var(--line,rgba(16,27,48,.1));border-radius:14px;padding:16px 18px;max-height:56vh;overflow-y:auto;overscroll-behavior:contain}",
      ".ffm-body a{color:var(--blue,#2f6fed);overflow-wrap:anywhere}",
      ".ffm-foot{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}",
      /* clickable previews */
      "[data-msg-id]{cursor:pointer}",
      "[data-msg-id]:focus-visible{outline:2px solid var(--blue,#2f6fed);outline-offset:2px}",
      ".msg-row[data-msg-id]:hover,.bell-item[data-msg-id]:hover,.ff-sup-item[data-msg-id]:hover{border-color:var(--blue,#2f6fed);background:rgba(47,111,237,.05)}",
      ".ff-table tr[data-msg-id]:hover{background:rgba(47,111,237,.045)}",
      ".msg-tap{display:inline-block;margin-top:8px;font-size:11.5px;font-weight:800;color:var(--blue,#2f6fed)}",
      ".msg-tap:hover{text-decoration:underline}",
      ".msg-row p{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}",
      /* bell preview: 2 lines se 3, aur tap hint */
      ".bi-body{-webkit-line-clamp:3;line-clamp:3;overflow-wrap:anywhere;word-break:break-word}",
      ".bi-tap{display:block;margin-top:4px;font-size:10.5px;font-weight:800;color:var(--blue,#2f6fed)}",
      ".ff-sup-item{white-space:normal;overflow-wrap:anywhere;word-break:break-word}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function ensureModal() {
    if (veil && veil.parentNode) return veil;
    veil = document.createElement("div");
    veil.className = "modal-veil";
    veil.id = "ffm-modal";
    veil.setAttribute("aria-hidden", "true");
    veil.innerHTML =
      '<div class="modal ffm-card" role="dialog" aria-modal="true" aria-label="Full message" tabindex="-1">' +
        '<button class="m-close" type="button" data-ffm-close aria-label="Close message">✕</button>' +
        '<div id="ffm-head"></div>' +
        '<div class="ffm-body" id="ffm-body"></div>' +
        '<div class="ffm-foot">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="ffm-copy">📋 Copy message</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-ffm-close>Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(veil);
    return veil;
  }

  function open(msg) {
    ensureStyles();
    var m = msg || {};
    var v = ensureModal();
    var meta = (m.meta || []).filter(function (x) { return !!x; });
    var head = '<span class="ffm-kind">' + esc(m.kind || "Message") + '</span>' +
      '<h3 class="ffm-title">' + esc(m.title || "Message") + "</h3>" +
      (meta.length ? '<div class="ffm-meta">' + meta.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join('<span class="sep">·</span>') + "</div>" : "");
    var headEl = v.querySelector("#ffm-head");
    var bodyEl = v.querySelector("#ffm-body");
    if (headEl) headEl.innerHTML = head;
    if (bodyEl) bodyEl.innerHTML = rich(m.body || "") || '<span style="color:var(--ink-mute,#888)">(empty message)</span>';
    v.setAttribute("data-ffm-text", String(m.body || ""));
    v.classList.add("open");
    v.setAttribute("aria-hidden", "false");
    var close = v.querySelector("[data-ffm-close]");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
  }

  function close() {
    if (!veil) return;
    veil.classList.remove("open");
    veil.setAttribute("aria-hidden", "true");
  }

  /* register(message, onOpen) -> id for data-msg-id */
  function register(msg, onOpen) {
    var id = "m" + (++seq);
    registry[id] = { msg: msg || {}, onOpen: onOpen || null };
    order.push(id);
    /* Re-render (inbox / bell refresh) purane entries ko hata deta hai —
       lamba session memory me grow na kare. */
    while (order.length > 300) delete registry[order.shift()];
    return id;
  }

  function activate(el) {
    if (!el) return;
    var rec = registry[el.getAttribute("data-msg-id")];
    if (!rec) return;
    open(rec.msg);
    if (typeof rec.onOpen === "function") {
      try { rec.onOpen(rec.msg); } catch (e) {}
    }
  }

  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-ffm-close]")) { close(); return; }
      if (t.id === "ffm-modal") { close(); return; }
      var copy = t.closest("#ffm-copy");
      if (copy && veil) {
        var text = veil.getAttribute("data-ffm-text") || "";
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        } catch (err) {}
        copy.textContent = "✓ Copied";
        setTimeout(function () { copy.textContent = "📋 Copy message"; }, 1600);
        return;
      }
      var el = t.closest("[data-msg-id]");
      if (el) { e.preventDefault(); activate(el); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && veil && veil.classList.contains("open")) {
        close();
        /* Support box / doosre modals bhi Escape sunte hain — sirf yahi
           band ho, pichhla support modal khula rahe. */
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      var t = e.target;
      if (!t || !t.closest) return;
      var el = t.closest("[data-msg-id]");
      if (el && el === t) { e.preventDefault(); activate(el); }
    });
  }

  window.FFMessage = {
    esc: esc, clip: clip, rich: rich, fmtDate: fmtDate,
    register: register, open: open, close: close
  };

  if (document) {
    ensureStyles();
    bind();
    if (!document.head) document.addEventListener("DOMContentLoaded", ensureStyles);
  }
})();
