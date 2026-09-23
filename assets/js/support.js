/* ============================================================
   FLEXFAM — support message box
   ------------------------------------------------------------
   Har logged-in page par neeche-right ek floating 💬 button.
   Click -> member admin ko message bhej sakta hai (title +
   body). Message public.messages table me jaata hai, admin
   use admin panel ke Messages section me "From: ..." ke saath
   dekhta hai, aur reply member ke dashboard inbox me aata hai.

   REQUIREMENT: supabase-member-messages.sql Supabase me run
   hona chahiye. Local/demo accounts ke liye box kaam nahi
   karta (server session chahiye).
   ============================================================ */

(function () {
  "use strict";
  if (!window.FF) return;

  const ID_BTN = "ff-support-btn";
  const ID_VEIL = "ff-support-modal";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
    ));
  }

  function fdate(t) {
    return t ? new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  }

  function buildUI() {
    if (document.getElementById(ID_BTN)) return;

    const btn = document.createElement("button");
    btn.id = ID_BTN;
    btn.type = "button";
    btn.setAttribute("aria-label", "Message support");
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    btn.style.cssText = [
      "position:fixed", "right:18px", "bottom:18px", "z-index:900",
      "width:52px", "height:52px", "border-radius:50%", "border:none",
      "cursor:pointer", "display:flex", "align-items:center", "justify-content:center",
      "color:#fff", "background:linear-gradient(135deg,var(--green,#22c55e),#0ea5e9)",
      "box-shadow:0 10px 24px rgba(34,197,94,.35)",
      "transition:transform .15s ease",
    ].join(";");
    btn.onmouseenter = () => (btn.style.transform = "scale(1.08)");
    btn.onmouseleave = () => (btn.style.transform = "scale(1)");
    btn.addEventListener("click", openModal);

    const veil = document.createElement("div");
    veil.id = ID_VEIL;
    veil.className = "modal-veil";
    veil.setAttribute("aria-hidden", "true");
    veil.innerHTML = [
      '<div class="modal" role="dialog" aria-modal="true" style="max-width:440px">',
      '  <button class="m-close" type="button" aria-label="Close" style="background:none;border:none;cursor:pointer;color:var(--ink-mute,#888);position:absolute;top:12px;right:12px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>',
      '  <h3 style="margin:0 0 4px">Message support 💬</h3>',
      '  <p class="m-sub" style="margin:0 0 14px">Ask anything — rejected proofs, payments, bugs. Our team replies in your dashboard inbox.</p>',
      '  <div class="field" style="text-align:left">',
      '    <label for="ff-sup-title">Subject (optional)</label>',
      '    <input type="text" id="ff-sup-title" maxlength="120" placeholder="e.g. Proof rejected by mistake" />',
      '  </div>',
      '  <div class="field" style="text-align:left">',
      '    <label for="ff-sup-body">Your message</label>',
      '    <textarea id="ff-sup-body" rows="4" maxlength="4000" placeholder="Write your message here…"></textarea>',
      '  </div>',
      '  <button class="btn btn-primary btn-block" id="ff-sup-send" type="button">Send message</button>',
      '  <div id="ff-sup-list" style="margin-top:16px;text-align:left"></div>',
      '</div>',
    ].join("");

    document.body.appendChild(btn);
    document.body.appendChild(veil);

    veil.querySelector(".m-close").addEventListener("click", closeModal);
    veil.addEventListener("click", (e) => { if (e.target === veil) closeModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && veil.classList.contains("open")) closeModal();
    });
    veil.querySelector("#ff-sup-send").addEventListener("click", send);
  }

  function openModal() {
    const veil = document.getElementById(ID_VEIL);
    if (!veil) return;
    veil.classList.add("open");
    veil.setAttribute("aria-hidden", "false");
    if (!FF.hasServer()) {
      document.getElementById("ff-sup-list").innerHTML =
        '<div class="fee-hint"><span>⚠️ Support messaging needs a real account — please <a href="login.html" style="text-decoration:underline">log in</a> (demo mode can\'t send messages).</span></div>';
      return;
    }
    loadHistory();
  }

  function closeModal() {
    const veil = document.getElementById(ID_VEIL);
    if (!veil) return;
    veil.classList.remove("open");
    veil.setAttribute("aria-hidden", "true");
  }

  function loadHistory() {
    const list = document.getElementById("ff-sup-list");
    if (!list) return;
    list.innerHTML = '<p style="font-size:12.5px;color:var(--ink-mute,#888)">Loading your messages…</p>';
    FF.rpc("messages_member_sent").then((rows) => {
      rows = rows || [];
      if (!rows.length) {
        list.innerHTML = "";
        return;
      }
      list.innerHTML = '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute,#888);margin-bottom:8px">Your recent messages</div>' +
        rows.map((m) => (
          '<div style="border-top:1px solid var(--line,#eee);padding:8px 0;font-size:13px">' +
          (m.title ? "<b>" + esc(m.title) + "</b><br>" : "") + esc(m.body) +
          '<br><span style="font-size:11.5px;color:var(--ink-mute,#888)">' + fdate(m.at) + "</span></div>"
        )).join("");
    }).catch(() => { list.innerHTML = ""; });
  }

  function send() {
    const btn = document.getElementById("ff-sup-send");
    const title = document.getElementById("ff-sup-title").value;
    const body = document.getElementById("ff-sup-body").value;
    if (!FF.hasServer()) {
      FF.toast("Support messaging needs a real account — please log in", "err");
      return;
    }
    if (!body || body.trim().length < 2) {
      FF.toast("Write a message first", "err");
      return;
    }
    btn.disabled = true; btn.style.opacity = ".6";
    FF.rpc("messages_member_send", { p_title: title || "", p_body: body }).then(() => {
      FF.toast("Message sent! Our team will reply in your dashboard inbox.", "ok");
      document.getElementById("ff-sup-title").value = "";
      document.getElementById("ff-sup-body").value = "";
      loadHistory();
    }).catch((err) => {
      FF.toast((err && err.message) || "Could not send — try again", "err");
    }).then(() => { btn.disabled = false; btn.style.opacity = ""; });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!FF.currentUser()) return;
    buildUI();
  });
})();
