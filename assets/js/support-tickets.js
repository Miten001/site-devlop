/* Private server-backed support. Never fake delivery in offline/demo mode. */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const FF = window.FF;
    const $ = (id) => document.getElementById(id);
    const adminMode = new URLSearchParams(window.location.search).get("admin") === "1";
    let adminSession = null;
    try { adminSession = JSON.parse(localStorage.getItem("ff_admin_session") || "null"); } catch (_) {}
    // The admin console has its own Supabase session. Never copy it into member storage.
    async function rpc(name, args) {
      if (!adminMode) return FF.rpc(name, args);
      const cfg = window.FF_SUPABASE_CONFIG;
      if (!cfg || !adminSession || !adminSession.access_token) throw new Error("Please sign in through the admin console first.");
      const response = await fetch(cfg.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { apikey: cfg.anonKey, Authorization: "Bearer " + adminSession.access_token, "Content-Type": "application/json" },
        body: JSON.stringify(args || {})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? "Admin session expired. Sign in again through the admin console." : data.message || "Support request failed.");
      return data;
    }
    let staff = false, selected = null, generation = 0;
    const statuses = { open: "Open", in_progress: "In Progress", resolved: "Resolved" };
    function notice(message, error) {
      $("support-notice").textContent = message;
      $("support-notice").classList.toggle("error", !!error);
    }
    function fail(err) {
      const message = err && err.message || "Unable to reach support. Please try again.";
      notice(/function.*does not exist|schema cache/i.test(message) ? "Support is not set up yet. Please contact the site administrator." : message, true);
    }
    function element(tag, text, cls) {
      const el = document.createElement(tag);
      if (text != null) el.textContent = text;
      if (cls) el.className = cls;
      return el;
    }
    function when(value) { return new Date(value).toLocaleString(); }
    async function loadList() {
      const filter = $("ticket-filter").value;
      const data = await rpc("support_list", { p_status: filter || null });
      // Ignore a response for a filter that has since changed.
      if ($("ticket-filter").value !== filter) return;
      staff = data.isAdmin === true;
      if (adminMode && !staff) throw new Error("Admin access required. Sign in with an authorized admin account.");
      $("new-ticket").closest("section").classList.toggle("hidden", adminMode);
      $("ticket-list-title").textContent = staff ? "All support tickets" : "My tickets";
      $("staff-controls").classList.toggle("hidden", !staff);
      $("support-app").classList.remove("hidden");
      const list = $("ticket-list"); list.replaceChildren();
      (data.tickets || []).forEach((ticket) => {
        const button = element("button", null, "ticket-item"); button.type = "button";
        button.setAttribute("aria-current", String(selected === ticket.id));
        button.append(element("b", ticket.subject), element("span", statuses[ticket.status] || ticket.status, "ticket-status " + ticket.status), element("small", ticket.category + " · " + when(ticket.updated_at) + " · #" + ticket.id.slice(0,8)));
        button.addEventListener("click", () => openThread(ticket.id).catch(fail)); list.append(button);
      });
      if (!list.children.length) list.append(element("p", "No tickets found. Create a ticket if you need help.", "support-hint"));
    }
    async function openThread(id) {
      const request = ++generation;
      $("support-reply").classList.add("hidden");
      const data = await rpc("support_thread", { p_ticket: id });
      if (request !== generation) return;
      selected = id;
      $("thread-title").textContent = data.ticket.subject;
      $("thread-meta").textContent = "#" + id.slice(0,8) + " · " + data.ticket.category + " · " + statuses[data.ticket.status] + " · Opened " + when(data.ticket.created_at);
      $("ticket-replies").replaceChildren();
      data.replies.forEach((reply) => {
        const article = element("article", null, "support-message" + (reply.is_staff ? " staff" : ""));
        const head = element("header"); head.append(element("b", reply.is_staff ? "Support team" : "Member"), element("time", when(reply.created_at)));
        article.append(head, element("p", reply.body)); $("ticket-replies").append(article);
      });
      $("reply-status").value = data.ticket.status;
      $("reply-body").value = "";
      $("reply-body").required = !staff;
      $("support-reply").classList.toggle("hidden", !staff && data.ticket.status === "resolved");
      if (!staff && data.ticket.status === "resolved") $("ticket-replies").append(element("p", "This ticket is resolved. Create a new ticket if you need more help.", "support-hint"));
      document.querySelectorAll(".ticket-item").forEach((button) => button.setAttribute("aria-current", "false"));
      $("thread-title").focus();
    }
    async function busy(form, action) {
      const button = form.querySelector('button[type="submit"]');
      if (button.disabled) return;
      button.disabled = true;
      try { await action(); } catch (err) { fail(err); } finally { button.disabled = false; }
    }
    $("support-create").addEventListener("submit", (event) => {
      event.preventDefault();
      busy(event.currentTarget, async () => {
        const id = await rpc("support_create", { p_category: $("ticket-category").value, p_subject: $("ticket-subject").value.trim(), p_body: $("ticket-body").value.trim() });
        $("support-create").reset(); $("new-ticket").open = false; $("ticket-filter").value = "";
        notice("Ticket submitted. You can check replies here.");
        await loadList(); await openThread(id);
      });
    });
    $("support-reply").addEventListener("submit", (event) => {
      event.preventDefault();
      const id = selected;
      if (!id) return;
      busy(event.currentTarget, async () => {
        await rpc("support_respond", { p_ticket: id, p_body: $("reply-body").value.trim(), p_status: staff ? $("reply-status").value : null });
        notice("Ticket updated.");
        await loadList();
        if (selected === id) await openThread(id);
      });
    });
    $("ticket-filter").addEventListener("change", () => loadList().catch(fail));
    $("support-refresh").addEventListener("click", async () => {
      const button = $("support-refresh"); button.disabled = true;
      try { await loadList(); if (selected) await openThread(selected); notice("Support is up to date."); } catch (err) { fail(err); } finally { button.disabled = false; }
    });
    if (adminMode) {
      const back = element("a", "Admin console", "btn btn-ghost btn-sm always");
      back.href = "admin.html"; document.querySelector(".head-actions").replaceChildren(back);
      if (!adminSession || !adminSession.access_token) {
        notice("Please sign in through the admin console first.", true);
        $("support-refresh").disabled = true; return;
      }
      loadList().then(() => notice("Admin support queue. Select a ticket to reply or update its status.")).catch(fail);
      return;
    }
    if (!FF || !FF.currentUser()) {
      notice("Please sign in to create and view private support tickets.");
      $("support-notice").append(document.createTextNode(" "), Object.assign(document.createElement("a"), { href: "login.html", textContent: "Sign in" }));
      $("support-refresh").disabled = true; return;
    }
    if (!FF.hasServer()) {
      notice("Support needs a live account session. Sign in with your registered account; demo and offline tickets cannot be delivered.", true);
      $("support-refresh").disabled = true; return;
    }
    loadList().then(() => notice("Your conversation is private to you and the support team. Use Refresh to check for replies.")).catch(fail);
  });
})();
