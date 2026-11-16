/* =========================================================================
   FlexFam — "How did this member earn?"  (admin withdrawal review)
   -------------------------------------------------------------------------
   Shows one member's money grouped by where it came from, so an admin can
   check a withdrawal before paying it out:

     • USDT in / out by source — tasks, streak, referrals, mining, deposits,
       conversions, escrow, rigs, withdrawals — with a balance check
     • coins (points) in / out by source
     • every deposit / withdrawal request the member made
     • who paid the member, and whose activity produced the referral income
     • the full money ledger (wallet + mining) with filters

   The numbers come from the admin-only RPC admin_member_earnings()
   (supabase-admin-member-earnings.sql). This file only renders them.

   Used by
     admin.html           inside the member modal
                          (FFEarnings.summaryHtml + FFEarnings.mountLedger)
     admin-payments.html  in its own modal (FFEarnings.open)

   Approve / reject are NOT handled here: the request card renders the same
   [data-ok] / [data-no] buttons each page already listens for.

   Standalone: no dependency on FF / wallet.js / the admin page helpers.
   ========================================================================= */
(function () {
  "use strict";

  var E = {};
  E.RPC = "admin_member_earnings";
  E.LIMIT = 300;        /* ledger rows on first load */
  E.MAX = 5000;         /* "Load all" cap — the SQL function enforces the same */
  /* Purchases compare at cent precision and clamp the debit at zero, so a
     ledger can sit a few cents away from the balance without anything being
     wrong. Anything larger is flagged. */
  E.TOLERANCE = 0.05;
  E.SQL_FILE = "supabase-admin-member-earnings.sql";

  var LABEL = {
    usdt: {
      tasks: "Task Market tasks completed",
      streak: "Daily streak rewards",
      referral: "Referral income",
      mining: "Mining claimed to USDT",
      from_points: "Coins converted to USDT",
      deposit: "Deposits approved",
      refund: "Task escrow refunded",
      admin_credit: "Added by an admin",
      other_credit: "Other credits",
      withdrawn: "Withdrawals paid",
      withdraw_pending: "Withdrawals waiting for approval",
      escrow: "Escrow for tasks this member posted",
      rigs: "Mining rigs bought with USDT",
      to_points: "USDT converted to coins",
      admin_debit: "Removed by an admin",
      other_debit: "Other debits"
    },
    points: {
      campaigns: "Point campaigns completed",
      referral: "Referral income",
      mining: "Mining claimed as coins",
      imported: "Earned in the browser, then imported",
      from_usdt: "USDT converted to coins",
      to_usdt: "Coins converted to USDT",
      rigs: "Mining rigs bought with coins",
      campaign_spend: "Paid out on own campaigns"
    }
  };
  /* What one entry of a source is called: [singular, plural]. */
  var NOUN = {
    tasks: ["task", "tasks"], streak: ["day", "days"], referral: ["payout", "payouts"],
    mining: ["claim", "claims"], deposit: ["deposit", "deposits"], refund: ["refund", "refunds"],
    withdrawn: ["withdrawal", "withdrawals"], withdraw_pending: ["request", "requests"],
    rigs: ["rig", "rigs"], campaigns: ["campaign", "campaigns"], imported: ["import", "imports"],
    from_points: ["conversion", "conversions"], to_points: ["conversion", "conversions"],
    from_usdt: ["conversion", "conversions"], to_usdt: ["conversion", "conversions"],
    admin_credit: ["edit", "edits"], admin_debit: ["edit", "edits"],
    campaign_spend: ["completion", "completions"],
    _: ["entry", "entries"]
  };
  /* "Earned (net)" — what the site itself added to this member's USDT.
     Rigs and conversions back to coins are subtracted: a member who cycles
     the same $100 through rigs ten times has not earned $1,000, and a
     deposit converted to coins and back is not an earning at all.
     Deposits, task escrow / refunds and admin edits are not earnings. */
  var EARNED = ["tasks", "streak", "referral", "mining", "rigs", "from_points", "to_points"];
  var EARNED_NOTE = "Earned (net) = tasks + streak + referrals + mining claims − rigs bought with USDT ± coin conversions.";

  var TYPE = {
    earning: "Task earning", streak: "Daily streak", quest: "Quest reward", referral: "Referral", convert: "Conversion",
    deposit: "Deposit", withdraw: "Withdrawal", escrow: "Task escrow", payout: "Paid from escrow",
    refund: "Escrow refund", adjust: "Browser import", claim: "Mining claim", rig: "Mining rig",
    buy: "Mining rig", boost: "Mining boost", admin: "Admin edit"
  };
  var FILTERS = [
    ["all", "All"], ["tasks", "Tasks"], ["referral", "Referral"], ["streak", "Streak"],
    ["mining", "Mining"], ["cash", "Deposits & withdrawals"], ["other", "Other"]
  ];
  var X_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  /* ---------------------------------------------------------------- utils */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  /* "|| 0" also turns -0 into 0, so a zero total never prints as "$-0.00". */
  function num(n) { n = Number(n); return (isFinite(n) && n) || 0; }
  function dollars(n, maxDigits) {
    n = num(n);
    return (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
  }
  function usd(n) { return dollars(n, 2); }
  /* Up to 4 decimals: a $0.001 streak reward must not read as $0.00. */
  function fine(n) { return dollars(n, 4); }
  function pts(n) { return (Math.round(num(n)) || 0).toLocaleString("en-IN"); }
  function money(cur, n) { return cur === "points" ? pts(n) + " coins" : fine(n); }
  function plain(cur, n) { n = num(n); return (n < 0 ? "−" : "") + money(cur, Math.abs(n)); }
  function signed(cur, n) {
    n = num(n);
    if (!n) return '<span class="ffe-mute">—</span>';
    return n > 0
      ? '<span class="ffe-pos">+' + esc(money(cur, n)) + "</span>"
      : '<span class="ffe-neg">−' + esc(money(cur, -n)) + "</span>";
  }
  /* The RPC sends epoch milliseconds; the REST fallback sends ISO strings. */
  function ms(at) {
    if (typeof at === "number") return at;
    if (/^\d+(\.\d+)?$/.test(String(at))) return Number(at);
    var t = Date.parse(at);
    return isNaN(t) ? 0 : t;
  }
  function day(at) {
    var d = new Date(ms(at));
    var o = { day: "2-digit", month: "short" };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return d.toLocaleDateString("en-IN", o);
  }
  function stamp(at) {
    var t = ms(at);
    if (!t) return "—";
    return new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function count(n, noun) { n = num(n); return pts(n) + " " + noun[n === 1 ? 0 : 1]; }

  /* PostgREST answers 404 / PGRST202 when the SQL file has not been run. */
  E.isMissing = function (err) {
    if (!err) return false;
    var m = String(err.message || "");
    if (/admins only/i.test(m)) return false;
    return err.status === 404 || /could not find|does not exist|schema cache|PGRST202|42883/i.test(m);
  };
  E.missingHint = "Earning details need one server function — run " + E.SQL_FILE +
    " once in the Supabase SQL editor, then refresh.";

  /* --------------------------------------------------------------- styles */
  function injectStyle() {
    if (!document || !document.head || document.getElementById("ffe-style")) return;
    var st = document.createElement("style");
    st.id = "ffe-style";
    st.textContent = [
      ".ffe{display:grid;gap:12px;text-align:left}",
      ".ffe-note{margin:0;font-size:13px;line-height:1.55;color:var(--ink-mute,#626d80)}",
      ".ffe-note.ffe-small{font-size:12px;margin-top:-4px}",
      ".ffe-note code{color:var(--amber,#9a6410);background:var(--glass-2,#f7f9fc);padding:2px 7px;border-radius:7px;font-size:12px}",
      ".ffe-req{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 14px;border-radius:12px;border:1px solid rgba(47,111,237,.35);background:rgba(47,111,237,.06)}",
      ".ffe-req-main{min-width:0;flex:1 1 240px;font-size:13.5px;color:var(--ink-dim,#4a5568)}",
      ".ffe-req-main b{color:var(--ink,#1b2330)}",
      ".ffe-req-meta{margin-top:4px;font-size:12px;color:var(--ink-mute,#626d80);overflow-wrap:anywhere}",
      ".ffe-req-act{display:flex;gap:8px;flex-wrap:wrap}",
      ".ffe-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}",
      ".ffe-stat{padding:11px 12px;border:1px solid var(--line,rgba(16,27,48,.1));border-radius:12px;background:var(--card,#fff)}",
      ".ffe-stat b{display:block;font-size:17px;font-weight:800;color:var(--ink,#1b2330);font-variant-numeric:tabular-nums}",
      ".ffe-stat span{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-mute,#626d80)}",
      ".ffe-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}",
      "@media (max-width:720px){.ffe-cols{grid-template-columns:1fr}}",
      ".ffe-card{min-width:0;border:1px solid var(--line,rgba(16,27,48,.1));border-radius:12px;overflow:hidden;background:var(--card,#fff)}",
      ".ffe-card>h5{margin:0;padding:10px 12px;font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-mute,#626d80);border-bottom:1px solid var(--line,rgba(16,27,48,.1));background:var(--glass-2,#f7f9fc)}",
      ".ffe-card>h5 small{font-weight:600;letter-spacing:0;text-transform:none}",
      ".ffe-scroll{overflow:auto;-webkit-overflow-scrolling:touch}",
      ".ffe-table{width:100%;border-collapse:collapse;font-size:13px}",
      ".ffe-table th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-mute,#626d80);padding:8px 10px;border-bottom:1px solid var(--line,rgba(16,27,48,.1));white-space:nowrap;background:var(--card,#fff)}",
      ".ffe-table td{padding:8px 10px;border-bottom:1px solid var(--line,rgba(16,27,48,.1));color:var(--ink-dim,#4a5568);vertical-align:top}",
      ".ffe-table tr:last-child td{border-bottom:0}",
      ".ffe-table td b{color:var(--ink,#1b2330)}",
      ".ffe-table .ffe-num{text-align:right;white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums}",
      ".ffe-table tr.ffe-total td{border-top:2px solid var(--line,rgba(16,27,48,.1));font-weight:800;color:var(--ink,#1b2330)}",
      ".ffe-table tr.ffe-group td{background:var(--glass-2,#f7f9fc);font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-mute,#626d80)}",
      ".ffe-table tr.ffe-group .ffe-num{font-size:13px;letter-spacing:0;text-transform:none}",
      ".ffe-table tr.ffe-on td{background:rgba(47,111,237,.07)}",
      ".ffe-table tr.ffe-off td{opacity:.55}",
      ".ffe-sub{display:block;font-size:11px;font-weight:500;color:var(--ink-mute,#626d80)}",
      ".ffe-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;overflow-wrap:anywhere}",
      ".ffe-pos{color:var(--green,#0f7a48)}",
      ".ffe-neg{color:#b42318}",
      ".ffe-mute{color:var(--ink-mute,#626d80);font-weight:500}",
      ".ffe-check{padding:10px 12px;border-top:1px solid var(--line,rgba(16,27,48,.1));font-size:12.5px;line-height:1.5;color:var(--ink-dim,#4a5568)}",
      ".ffe-check.ok{background:rgba(15,122,72,.07);color:#0f7a48}",
      ".ffe-check.bad{background:rgba(229,72,77,.09);color:#b42318;font-weight:700}",
      ".ffe-facts{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-dim,#4a5568)}",
      ".ffe-facts b{color:var(--ink,#1b2330)}",
      ".ffe-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px}",
      ".ffe-chip{border:1px solid var(--line,rgba(16,27,48,.1));background:var(--glass-2,#f7f9fc);color:var(--ink-dim,#4a5568);padding:5px 11px;border-radius:999px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}",
      ".ffe-chip:hover{color:var(--ink,#1b2330)}",
      ".ffe-chip.on{border-color:var(--blue,#2f6fed);color:var(--ink,#1b2330);background:rgba(47,111,237,.1)}",
      ".ffe-chip:focus-visible{outline:2px solid var(--blue,#2f6fed);outline-offset:2px}",
      ".ffe-meta{margin:0 0 8px;font-size:12px;color:var(--ink-mute,#626d80)}",
      ".ffe-ledger{max-height:340px;border:1px solid var(--line,rgba(16,27,48,.1));border-radius:12px}",
      ".ffe-ledger .ffe-table th{position:sticky;top:0}",
      ".ffe-when{white-space:nowrap}",
      ".ffe-detail{min-width:150px;overflow-wrap:anywhere}",
      ".ffe-pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;border:1px solid rgba(47,111,237,.35);color:var(--blue,#2f6fed)}",
      ".ffe-pill.mining{border-color:rgba(154,100,16,.35);color:var(--amber,#9a6410)}",
      ".ffe-open{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:4px 10px;border-radius:9px;border:1px solid var(--line,rgba(16,27,48,.1));background:var(--glass-2,#f7f9fc);color:var(--blue,#2f6fed);font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap}",
      ".ffe-open:hover{border-color:var(--blue,#2f6fed)}",
      ".ffe-open:focus-visible{outline:2px solid var(--blue,#2f6fed);outline-offset:2px}",
      ".ffe-modal{width:min(880px,100%);max-height:92vh;overflow-y:auto;text-align:left}",
      ".ffe-h{margin:20px 0 10px;font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-mute,#626d80)}"
    ].join("\n");
    document.head.appendChild(st);
  }

  /* The button both admin pages put on a payment row. Each page decides what
     a click on [data-ffe-open] opens. */
  E.isRequestId = function (id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
  };
  /* Only requests stored on the server have earning details; a demo-mode
     request (browser id such as "req_ab12") gets no button. */
  E.buttonHtml = function (requestId) {
    if (!E.isRequestId(requestId)) return "";
    return '<button type="button" class="ffe-open" data-ffe-open="' + esc(requestId) +
      '" title="See where this member\'s balance came from before you approve">🔍 How earned</button>';
  };

  /* ------------------------------------------------- request under review */
  /* A row from the payments queue has no status while it is pending, and a
     settled queue row has no network / address — show what is there. */
  function requestHtml(r, opts) {
    var isWd = r.kind === "withdraw";
    var status = r.status || "pending";
    var bits = [];
    if (isWd && num(r.fee) && status !== "rejected") {
      bits.push("member " + (status === "approved" ? "received " : "receives ") + usd(r.receive) + " after the " + usd(r.fee) + " fee");
    }
    if (r.network) bits.push(r.network);
    if (r.txid || r.address) bits.push(r.txid || r.address);
    if (r.at) bits.push("requested " + stamp(r.at));
    if (status !== "pending" && r.settledAt) bits.push("settled " + stamp(r.settledAt));
    if (r.adminNote) bits.push("note: " + r.adminNote);
    var act = status === "pending" && opts.actions !== false && r.id
      ? '<div class="ffe-req-act"><button type="button" class="btn btn-primary btn-sm" data-ok="' + esc(r.id) + '">Approve</button> ' +
        '<button type="button" class="btn btn-ghost btn-sm" data-no="' + esc(r.id) + '">Reject</button></div>'
      : "";
    return '<div class="ffe-req"><div class="ffe-req-main"><b>' + (isWd ? "Withdrawal" : "Deposit") + " request · " + esc(usd(r.amount)) + "</b> " +
      '<span class="badge ' + esc(status) + '">' + esc(status) + "</span>" +
      (bits.length ? '<div class="ffe-req-meta">' + esc(bits.join(" · ")) + "</div>" : "") +
      "</div>" + act + "</div>";
  }

  /* ---------------------------------------------------- one currency card */
  /* Laid out like a statement: everything in (largest first), everything
     out (largest first), then the difference and the balance check. */
  function sourceCard(cur, title, block, check) {
    block = block || {};
    var rows = block.rows || [];
    var ins = rows.filter(function (r) { return num(r.amount) > 0; })
      .sort(function (a, b) { return num(b.amount) - num(a.amount); });
    var outs = rows.filter(function (r) { return num(r.amount) < 0; })
      .sort(function (a, b) { return num(a.amount) - num(b.amount); });
    function line(r) {
      var first = r.first ? day(r.first) : "";
      var last = r.last ? day(r.last) : "";
      var span = first ? first + (last && last !== first ? " – " + last : "") : "";
      return "<tr><td><b>" + esc((LABEL[cur] || {})[r.key] || r.key) + "</b>" +
        '<span class="ffe-sub">' + esc(count(r.count, NOUN[r.key] || NOUN._) + (span ? " · " + span : "")) + "</span></td>" +
        '<td class="ffe-num">' + signed(cur, r.amount) + "</td></tr>";
    }
    function head(label, total) {
      return '<tr class="ffe-group"><td>' + label + '</td><td class="ffe-num">' + signed(cur, total) + "</td></tr>";
    }
    var none = '<tr><td colspan="2" class="ffe-mute">Nothing recorded yet.</td></tr>';
    var what = cur === "points" ? "Coins" : "Money";
    var body = head(what + " in", block["in"]) + (ins.map(line).join("") || none) +
      head(what + " out", block.out) + (outs.map(line).join("") || none) +
      '<tr class="ffe-total"><td>In − out</td><td class="ffe-num">' + esc(plain(cur, block.net)) + "</td></tr>";
    return '<div class="ffe-card"><h5>' + esc(title) + '</h5><div class="ffe-scroll"><table class="ffe-table"><tbody>' + body +
      "</tbody></table></div>" + check + "</div>";
  }

  function usdtCheck(u) {
    var diff = num(u.diff);
    if (Math.abs(diff) < E.TOLERANCE) {
      return '<div class="ffe-check ok" data-ffe-check="ok">✓ Balance check passed — these entries add up to the available ' +
        esc(fine(u.balance)) + (Math.abs(diff) >= 0.00005 ? " (rounding difference " + esc(fine(Math.abs(diff))) + ")" : "") + ".</div>";
    }
    return '<div class="ffe-check bad" data-ffe-check="bad">⚠ Balance check failed — ' + (diff > 0
      ? esc(fine(diff)) + " of the available " + esc(fine(u.balance)) + " has no matching entry."
      : "these entries add up to " + esc(fine(-diff)) + " more than the available " + esc(fine(u.balance)) + ".") +
      " Check the ledger below before you approve.</div>";
  }
  function pointsCheck(p) {
    var diff = num(p.diff);
    if (!diff) {
      return '<div class="ffe-check ok">✓ These entries add up to the coin balance of ' + esc(pts(p.balance)) + ".</div>";
    }
    return '<div class="ffe-check">Coin balance is ' + esc(pts(p.balance)) + " — " + esc(pts(Math.abs(diff))) + " coins " +
      (diff > 0 ? "more" : "fewer") + " than these entries. Admin coin edits and campaign payout changes are not itemised.</div>";
  }

  function defaultMemberCell(id, name, email) {
    return "<b>" + esc(name || email || "Member") + "</b>" + (email && name ? '<span class="ffe-sub">' + esc(email) + "</span>" : "");
  }

  /* ---------------------------------------------------------- the summary */
  /* opts.request     fallback request row from the page's own queue
     opts.loading     true while the RPC call is in flight
     opts.error       the Error when the RPC call failed
     opts.memberCell  function (id, name, email) → HTML for a member reference
     opts.actions     false hides Approve / Reject on a pending request
     opts.balances    false hides the "available / coins" stats (admin.html
                      already shows them above the summary) */
  E.summaryHtml = function (d, opts) {
    opts = opts || {};
    injectStyle();
    var req = (d && d.request) || opts.request || null;
    var html = req ? requestHtml(req, opts) : "";

    if (!d) {
      html += '<p class="ffe-note">' + (opts.loading ? "Loading earnings…" : E.isMissing(opts.error)
        ? "Run <code>" + E.SQL_FILE + "</code> once in the Supabase SQL editor to see where this member's balance came from — tasks, streak, referrals, mining and deposits — before you approve a withdrawal."
        : "Could not load the earnings breakdown: " + esc((opts.error && opts.error.message) || "unknown error")) + "</p>";
      return '<div class="ffe">' + html + "</div>";
    }

    var u = d.usdt || {}, p = d.points || {}, bal = d.balance || {};
    var cell = typeof opts.memberCell === "function" ? opts.memberCell : defaultMemberCell;
    var by = {};
    (u.rows || []).forEach(function (r) { by[r.key] = num(r.amount); });
    var earned = EARNED.reduce(function (n, k) { return n + (by[k] || 0); }, 0);

    function stat(value, label, title) {
      return '<div class="ffe-stat"' + (title ? ' title="' + esc(title) + '"' : "") + "><b>" + esc(value) + "</b><span>" + esc(label) + "</span></div>";
    }
    html += '<div class="ffe-stats">' +
      stat(usd(earned), "Earned (net)", EARNED_NOTE) +
      stat(usd(by.deposit || 0), "Deposited") +
      stat(usd(Math.abs(by.withdrawn || 0)), "Withdrawn so far") +
      stat(usd(Math.abs(by.withdraw_pending || 0)), "Waiting to withdraw") +
      (opts.balances === false ? "" :
        stat(usd(bal.usdt), "Available now") + stat(pts(bal.points), "Coins")) +
      "</div>" +
      '<p class="ffe-note ffe-small">' + esc(EARNED_NOTE) + "</p>";

    html += '<div class="ffe-cols">' +
      sourceCard("usdt", "USDT — where it came from, where it went", u, usdtCheck(u)) +
      sourceCard("points", "Coins (points) — where they came from, where they went", p, pointsCheck(p)) +
      "</div>";

    /* ---- small facts ---- */
    var facts = [];
    var lock = d.locked || {};
    if (num(bal.locked) || num(lock.withdrawals) || num(lock.escrow)) {
      facts.push("Locked <b>" + esc(usd(bal.locked)) + "</b> = " + esc(usd(lock.withdrawals)) + " in " +
        esc(count(lock.withdrawCount, ["pending withdrawal", "pending withdrawals"])) + " + " + esc(usd(lock.escrow)) + " task escrow");
    }
    if (d.streak) {
      facts.push("Daily streak <b>day " + esc(pts(d.streak.streak)) + "</b> (best " + esc(pts(d.streak.best)) + ", " +
        esc(count(d.streak.claims, ["check-in", "check-ins"])) + ")");
    }
    var ref = d.referral || {};
    facts.push("Direct invites <b>" + esc(pts(ref.direct)) + "</b>");
    if (by.mining || by.rigs) {
      facts.push("Mining in USDT <b>" + esc(plain("usdt", (by.mining || 0) + (by.rigs || 0))) + "</b> net (" +
        esc(fine(by.mining || 0)) + " claimed − " + esc(fine(Math.abs(by.rigs || 0))) + " rigs)");
    }
    if (num(bal.miningUnclaimed)) facts.push("Mined, not claimed yet <b>" + esc(fine(bal.miningUnclaimed)) + "</b>");
    if (num(d.adminEdits)) facts.push("Admin balance edits <b>" + esc(pts(d.adminEdits)) + "</b>");
    if (facts.length) html += '<div class="ffe-facts">' + facts.map(function (f) { return "<span>" + f + "</span>"; }).join("") + "</div>";

    /* ---- every deposit / withdrawal request ---- */
    var reqs = d.requests || [];
    if (reqs.length) {
      html += '<div class="ffe-card"><h5>Deposits &amp; withdrawals <small>· ' + esc(count(reqs.length, ["request", "requests"])) + "</small></h5>" +
        '<div class="ffe-scroll" style="max-height:240px"><table class="ffe-table" style="min-width:520px"><thead><tr>' +
        "<th>Date</th><th>Type</th><th>Network</th><th>TXID / Address</th><th>Amount</th><th>Status</th></tr></thead><tbody>" +
        reqs.map(function (r) {
          var on = req && String(req.id) === String(r.id);
          return "<tr" + (on ? ' class="ffe-on"' : "") + '><td class="ffe-when">' + esc(stamp(r.at)) + "</td>" +
            "<td>" + (r.kind === "deposit" ? "Deposit" : "Withdrawal") + (on ? '<span class="ffe-sub">this request</span>' : "") + "</td>" +
            "<td>" + esc(r.network || "—") + "</td>" +
            '<td><span class="ffe-mono">' + esc(r.txid || r.address || "—") + "</span></td>" +
            '<td class="ffe-num">' + esc(usd(r.amount)) + (num(r.fee) ? '<span class="ffe-sub">net ' + esc(usd(r.receive)) + "</span>" : "") + "</td>" +
            '<td><span class="badge ' + esc(r.status) + '">' + esc(r.status) + "</span>" +
            (r.adminNote ? '<span class="ffe-sub">' + esc(r.adminNote) + "</span>" : "") + "</td></tr>";
        }).join("") + "</tbody></table></div></div>";
    }

    /* ---- counterparties: who paid, and whose activity paid referral income ---- */
    var payers = d.payers || [], down = ref.downline || [];
    if (payers.length || down.length) {
      var levels = (ref.levels || []).map(function (l) {
        return "L" + pts(l.level) + " " + fine(l.usdt) + (num(l.points) ? " + " + pts(l.points) + " coins" : "");
      }).join(" · ");
      html += '<div class="ffe-cols">' +
        (payers.length
          ? '<div class="ffe-card"><h5>Task Market — who paid this member</h5><div class="ffe-scroll" style="max-height:240px"><table class="ffe-table"><thead><tr>' +
            '<th>Task poster</th><th style="text-align:right">Tasks</th><th style="text-align:right">Paid</th></tr></thead><tbody>' +
            payers.map(function (x) {
              return "<tr><td>" + cell(x.userId, x.name, x.email) + '</td><td class="ffe-num">' + esc(pts(x.count)) +
                '</td><td class="ffe-num">' + esc(fine(x.amount)) + "</td></tr>";
            }).join("") + "</tbody></table></div></div>"
          : "") +
        (down.length
          ? '<div class="ffe-card"><h5>Referral income — whose activity paid it' + (levels ? " <small>· " + esc(levels) + "</small>" : "") + "</h5>" +
            '<div class="ffe-scroll" style="max-height:240px"><table class="ffe-table"><thead><tr>' +
            '<th>Invited member</th><th>Level</th><th style="text-align:right">USDT</th><th style="text-align:right">Coins</th></tr></thead><tbody>' +
            down.map(function (x) {
              return "<tr><td>" + cell(x.userId, x.name, x.email) + '<span class="ffe-sub">' + esc(count(x.count, NOUN.referral)) + "</span></td>" +
                "<td>L" + esc(pts(x.level)) + '</td><td class="ffe-num">' + esc(fine(x.usdt)) +
                '</td><td class="ffe-num">' + esc(pts(x.points)) + "</td></tr>";
            }).join("") + "</tbody></table></div></div>"
          : "") +
        "</div>";
    }

    return '<div class="ffe">' + html + "</div>";
  };

  /* ----------------------------------------------------------- the ledger */
  /* One row: { at, src: wallet|mining, type, unit: usdt|points|list, amount,
     note, status, counted }.  unit "list" = a USD list price whose real
     currency is unknown (REST fallback for mining purchases). */
  E.rows = function (d) {
    return ((d && d.ledger) || []).map(function (r) {
      return { at: r.at, src: r.src, type: r.type, unit: r.unit, amount: num(r.amount),
        note: r.note || "", status: r.status || "completed", counted: r.counted !== false };
    });
  };

  function group(r) {
    if (r.src === "mining") return "mining";
    if (r.type === "earning" || r.type === "escrow" || r.type === "payout" || r.type === "refund") return "tasks";
    if (r.type === "referral") return "referral";
    if (r.type === "streak") return "streak";
    if (r.type === "deposit" || r.type === "withdraw") return "cash";
    return "other";
  }

  function paintLedger(el) {
    var s = el._ffe;
    if (!s) return;
    var rows = s.rows, counts = { all: rows.length };
    rows.forEach(function (r) { var g = group(r); counts[g] = (counts[g] || 0) + 1; });
    if (s.filter !== "all" && !counts[s.filter]) s.filter = "all";
    var shown = s.filter === "all" ? rows : rows.filter(function (r) { return group(r) === s.filter; });

    var chips = FILTERS.filter(function (f) { return f[0] === "all" || counts[f[0]]; }).map(function (f) {
      var on = s.filter === f[0];
      return '<button type="button" class="ffe-chip' + (on ? " on" : "") + '" data-ffe-filter="' + f[0] + '" aria-pressed="' + on + '">' +
        esc(f[1]) + " · " + pts(counts[f[0]] || 0) + "</button>";
    }).join("");

    var meta = "";
    if (!s.server) {
      if (rows.length) meta = "Latest entries only. Run " + esc(E.SQL_FILE) + " for the complete ledger.";
    } else if (s.total > rows.length) {
      meta = "Showing the latest " + pts(rows.length) + " of " + pts(s.total) + " entries." +
        (s.loadAll ? ' <button type="button" class="ffe-chip" data-ffe-all' + (s.busy ? " disabled" : "") + ">" +
          (s.busy ? "Loading…" : s.failed ? "Retry — load all" : "Load all") + "</button>" : "");
    } else if (rows.length) {
      meta = "All " + count(rows.length, NOUN._) + ", newest first. Greyed rows did not change the spendable balance.";
    }

    var body = shown.map(function (r) {
      var amt = num(r.amount);
      var note = String(r.note || "—") + (r.status && r.status !== "completed" ? " (" + r.status + ")" : "");
      var cellHtml = !amt ? '<span class="ffe-mute">—</span>'
        : r.unit === "list" ? '<span class="ffe-mute">list price ' + esc(fine(Math.abs(amt))) + "</span>"
        : signed(r.unit === "points" ? "points" : "usdt", amt);
      return "<tr" + (r.counted === false ? ' class="ffe-off" title="This entry did not change the spendable balance"' : "") + ">" +
        '<td class="ffe-when">' + esc(stamp(r.at)) + "</td>" +
        '<td><span class="ffe-pill ' + (r.src === "mining" ? "mining" : "wallet") + '">' + esc(TYPE[r.type] || r.type || "Entry") + "</span></td>" +
        '<td class="ffe-detail">' + esc(note) + "</td>" +
        '<td class="ffe-num">' + cellHtml + "</td></tr>";
    }).join("") || '<tr><td colspan="4" class="ffe-mute">No coin or USDT entries recorded yet.</td></tr>';

    el.innerHTML = (chips ? '<div class="ffe-bar">' + chips + "</div>" : "") +
      (meta ? '<p class="ffe-meta">' + meta + "</p>" : "") +
      '<div class="ffe-scroll ffe-ledger"><table class="ffe-table"><thead><tr><th>Time</th><th>Source</th><th>Detail</th>' +
      '<th style="text-align:right">Amount</th></tr></thead><tbody>' + body + "</tbody></table></div>";
  }

  /* cfg.rows     rows in the shape documented above
     cfg.total    how many entries exist on the server (default: rows.length)
     cfg.server   true when the rows came from the RPC
     cfg.loadAll  function () → Promise of a fresh RPC payload with every row
     cfg.loading  true paints a placeholder instead of rows
     cfg.failed   true says the ledger could not be loaded (never "no entries") */
  E.mountLedger = function (el, cfg) {
    if (!el) return;
    cfg = cfg || {};
    injectStyle();
    el.setAttribute("data-ffe-ledger", "");
    if (cfg.loading || cfg.failed) {
      el._ffe = null;
      el.innerHTML = '<p class="ffe-meta">' + (cfg.loading ? "Loading the ledger…" : "The ledger could not be loaded.") + "</p>";
      return;
    }
    var rows = cfg.rows || [];
    el._ffe = {
      rows: rows,
      total: cfg.total == null ? rows.length : num(cfg.total),
      server: !!cfg.server,
      loadAll: typeof cfg.loadAll === "function" ? cfg.loadAll : null,
      filter: "all", busy: false, failed: false
    };
    paintLedger(el);
  };

  /* --------------------------------------------- standalone modal (open) */
  var veil = null;      /* the modal element, created on first use */
  var current = null;   /* { cfg, opener } of the open modal — also guards stale responses */

  function byId(id) { return document.getElementById(id); }

  function ensureModal() {
    if (veil) return veil;
    injectStyle();
    veil = document.createElement("div");
    veil.className = "modal-veil";
    veil.id = "ffe-modal";
    veil.setAttribute("aria-hidden", "true");
    veil.innerHTML = '<div class="modal modal-pos ffe-modal" role="dialog" aria-modal="true" aria-labelledby="ffe-title" tabindex="-1">' +
      '<button class="m-close" type="button" data-ffe-close aria-label="Close earning details">' + X_SVG + "</button>" +
      '<h3 id="ffe-title">How this member earned</h3><p class="m-sub" id="ffe-sub"></p>' +
      '<div id="ffe-body"></div><h4 class="ffe-h">Money ledger</h4><div id="ffe-ledger"></div></div>';
    document.body.appendChild(veil);
    veil.addEventListener("click", function (e) {
      if (e.target === veil || (e.target.closest && e.target.closest("[data-ffe-close]"))) E.close();
    });
    return veil;
  }

  function args(cfg, limit) {
    var a = { p_limit: limit };
    if (cfg.user) a.p_user = cfg.user;
    if (cfg.request) a.p_request = cfg.request;
    return a;
  }

  function load(ctx) {
    var cfg = ctx.cfg;
    return Promise.resolve().then(function () { return cfg.rpc(E.RPC, args(cfg, E.LIMIT)); }).then(function (d) {
      if (current !== ctx) return;
      var m = (d && d.member) || {};
      byId("ffe-title").textContent = m.name || (cfg.row && cfg.row.name) || "How this member earned";
      byId("ffe-sub").textContent = [m.email || (cfg.row && cfg.row.email) || "", m.joinedAt ? "joined " + day(m.joinedAt) : ""]
        .filter(Boolean).join(" · ");
      byId("ffe-body").innerHTML = E.summaryHtml(d, { request: cfg.row, actions: cfg.actions });
      E.mountLedger(byId("ffe-ledger"), {
        rows: E.rows(d), total: d && d.ledgerTotal, server: true,
        loadAll: function () { return cfg.rpc(E.RPC, args(cfg, E.MAX)); }
      });
    }, function (err) {
      if (current !== ctx) return;
      byId("ffe-body").innerHTML = E.summaryHtml(null, { request: cfg.row, error: err, actions: cfg.actions });
      E.mountLedger(byId("ffe-ledger"), { failed: true });
    });
  }

  /* cfg.rpc      function (name, args) → Promise   (required)
     cfg.request  pay_requests.id the modal is opened for
     cfg.user     member id (use instead of / together with request)
     cfg.row      the page's own queue row — shown while loading and when the
                  RPC is not installed
     cfg.actions  false hides Approve / Reject */
  E.open = function (cfg) {
    cfg = cfg || {};
    if (typeof cfg.rpc !== "function" || (!cfg.request && !cfg.user)) return Promise.resolve();
    ensureModal();
    /* refresh() keeps the element that had focus before the first open */
    current = { cfg: cfg, opener: E.isOpen() && current ? current.opener : document.activeElement };
    byId("ffe-title").textContent = (cfg.row && cfg.row.name) || "How this member earned";
    byId("ffe-sub").textContent = (cfg.row && cfg.row.email) || "";
    byId("ffe-body").innerHTML = E.summaryHtml(null, { request: cfg.row, loading: true, actions: false });
    E.mountLedger(byId("ffe-ledger"), { loading: true });
    veil.classList.add("open");
    veil.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    var dialog = veil.querySelector(".modal");
    if (dialog && dialog.focus) { try { dialog.focus(); } catch (e) {} }
    return load(current);
  };

  /* Re-read the numbers for the open modal — call after approve / reject. */
  E.refresh = function () {
    if (!current || !E.isOpen()) return Promise.resolve();
    return load(current);
  };

  E.isOpen = function () { return !!(veil && veil.classList.contains("open")); };

  E.close = function () {
    if (!veil) return;
    veil.classList.remove("open");
    veil.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    var opener = current && current.opener;
    current = null;
    /* the row may be gone after approve / reject — then there is nothing to focus */
    if (opener && opener.focus && document.body.contains(opener)) { try { opener.focus(); } catch (e) {} }
  };

  /* --------------------------------------------------------------- events */
  if (typeof document !== "undefined") {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest("[data-ffe-filter]");
      var all = chip ? null : t.closest("[data-ffe-all]");
      if (!chip && !all) return;
      var el = (chip || all).closest("[data-ffe-ledger]");
      var s = el && el._ffe;
      if (!s) return;
      if (chip) {
        s.filter = chip.getAttribute("data-ffe-filter") || "all";
        paintLedger(el);
        return;
      }
      if (s.busy || !s.loadAll) return;
      s.busy = true;
      s.failed = false;
      paintLedger(el);
      Promise.resolve().then(function () { return s.loadAll(); }).then(function (d) {
        if (el._ffe !== s) return;   /* re-mounted for another member meanwhile */
        s.busy = false;
        if (d && d.ledger) {
          s.rows = E.rows(d);
          s.total = d.ledgerTotal == null ? s.rows.length : num(d.ledgerTotal);
        }
        paintLedger(el);
      }, function () {
        if (el._ffe !== s) return;
        s.busy = false;
        s.failed = true;
        paintLedger(el);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && E.isOpen()) E.close();
    });
  }

  if (typeof document !== "undefined") {
    if (document.head) injectStyle();
    else document.addEventListener("DOMContentLoaded", injectStyle);
  }

  E.usd = usd;
  E.fine = fine;
  E.pts = pts;
  window.FFEarnings = E;
})();
