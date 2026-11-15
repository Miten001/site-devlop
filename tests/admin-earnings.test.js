/* =========================================================================
   FlexFam — admin "How earned" (withdrawal review) tests
   -------------------------------------------------------------------------
   Requirement: when a member asks for a withdrawal, the admin must be able
   to see how that member earned the money before approving it.

   Covers
     1. supabase-admin-member-earnings.sql — admins only, read-only, grants
     2. wiring in admin.html / admin-payments.html and the docs
     3. assets/js/admin-earnings.js — request card, sources, balance check
     4. the money ledger — filters, "Load all", fallbacks
     5. the standalone window used by admin-payments.html
     6. admin.html in jsdom: Payments → "How earned" → member modal
     7. admin-payments.html in jsdom

   tests/fixtures/admin-member-earnings.json is a real payload: what
   admin_member_earnings() returned on a throwaway Postgres built from this
   repository's SQL files, for a member who has every kind of entry.
   No network / Supabase credentials required.
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : "")); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
/* Visible text with one space between pieces — textContent alone glues
   neighbouring table cells together ("Money in+$33.61"). */
function flat(el) {
  const parts = [];
  (function walk(node) {
    if (!node) return;
    node.childNodes.forEach((c) => { if (c.nodeType === 3) parts.push(c.nodeValue); else if (c.nodeType === 1) walk(c); });
  })(el);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function waitFor(fn, label, ms) {
  const until = Date.now() + (ms || 3000);
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() > until) throw new Error("timed out waiting for: " + label);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const FIXTURE = read("tests/fixtures/admin-member-earnings.json");
const payload = (edit) => { const d = JSON.parse(FIXTURE); if (edit) edit(d); return d; };
const BASE = payload();
const MEMBER = BASE.member;          /* Alice */
const REQ = BASE.request;            /* her pending $10 withdrawal */
const SQL_FILE = "supabase-admin-member-earnings.sql";

/* Inline local scripts so jsdom runs them. supabase-config.js is left out:
   every test supplies its own config and must never see the live project. */
function inlined(file) {
  return read(file).replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const rel = src.split("?")[0];
    if (/supabase-config\.js$/.test(rel) || !exists(rel)) return "";
    return "<script>" + read(rel) + "<\/script>";
  });
}

function browser(html, url, setup) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));
  const dom = new JSDOM(html, {
    url: url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => "";
      if (setup) setup(window);
    }
  });
  return { dom, window: dom.window, doc: dom.window.document, errors };
}

const reply = (value, status) => Promise.resolve({
  ok: !status || status < 400,
  status: status || 200,
  headers: { get: () => "0-0/0" },
  text: () => Promise.resolve(JSON.stringify(value)),
  json: () => Promise.resolve(value)
});
/* What PostgREST answers when the SQL file has not been run. */
const MISSING_RPC = {
  code: "PGRST202", details: null, hint: null,
  message: "Could not find the function public.admin_member_earnings(p_limit, p_request, p_user) in the schema cache"
};

const queueRow = () => ({
  id: REQ.id, kind: "withdraw", email: MEMBER.email, name: MEMBER.name, amount: REQ.amount, fee: REQ.fee,
  receive: REQ.receive, network: REQ.network, txid: null, address: REQ.address, at: REQ.at
});

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 1] SQL — admins only, read-only");
  const sql = read(SQL_FILE);
  const code = sql.replace(/--[^\n]*/g, "");
  const body = (/as \$\$([\s\S]*?)\$\$;/.exec(code.slice(code.indexOf("create or replace function"))) || [])[1] || "";
  check("Defines admin_member_earnings(p_user, p_request, p_limit) → jsonb",
    /create or replace function public\.admin_member_earnings\(\s*p_user\s+uuid default null,\s*p_request\s+uuid default null,\s*p_limit\s+int\s+default 300\s*\)\s*returns jsonb/.test(code));
  check("Only one function is created — nothing existing is replaced",
    (code.match(/create or replace function/g) || []).length === 1 && !/create (table|policy|trigger|index)|alter table|drop /i.test(code));
  check("security definer with a pinned search_path", /security definer\s+set search_path = public/.test(code));
  const guardAt = body.indexOf("if not public.is_admin() then");
  const firstRead = body.search(/\bselect\b/);
  check("The admin guard runs before the first query", guardAt > -1 && firstRead > -1 && guardAt < firstRead &&
    /raise exception 'Admins only' using errcode = 'P0001'/.test(body));
  check("The function body never writes",
    body.length > 2000 && !/\b(insert\s+into|update\s+\w|delete\s+from|truncate|alter\s|drop\s|create\s|grant\s|perform\s)/i.test(body), body.length);
  check("A request that belongs to another member is refused", /That payment request belongs to another member/.test(body));
  check("Not callable by the anon role", /revoke all on function public\.admin_member_earnings\(uuid, uuid, int\) from public, anon;/.test(code) &&
    /grant execute on function public\.admin_member_earnings\(uuid, uuid, int\) to authenticated;/.test(code));
  check("Reloads the PostgREST schema cache", /notify pgrst, 'reload schema';/.test(code));
  check("Ledger size is capped", /least\(greatest\(coalesce\(p_limit, 300\), 1\), 5000\)/.test(body));
  check("Rows that never moved the balance are not counted",
    /when t\.type = 'payout'\s+then null/.test(body) && /when t\.type = 'deposit'\s+then case when t\.status = 'completed' then 'deposit' end/.test(body));

  const js = read("assets/js/admin-earnings.js");
  const usdtKeys = ["tasks", "streak", "referral", "mining", "from_points", "deposit", "refund", "admin_credit", "other_credit",
    "withdrawn", "withdraw_pending", "escrow", "rigs", "to_points", "admin_debit", "other_debit"];
  const pointKeys = ["campaigns", "referral", "mining", "imported", "from_usdt", "to_usdt", "rigs", "campaign_spend"];
  const unlabeled = usdtKeys.concat(pointKeys).filter((k) => !new RegExp("'" + k + "'").test(body) || !new RegExp("\\b" + k + ": \"").test(js));
  check("Every source the SQL reports has a label on the page", unlabeled.length === 0, unlabeled);

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 2] Wiring + docs");
  const admin = read("admin.html");
  const payments = read("admin-payments.html");
  check("admin.html loads admin-earnings.js before its own script",
    /<script src="assets\/js\/admin-earnings\.js\?v=[\d.]+"><\/script>\s*<script>/.test(admin));
  check("admin-payments.html loads admin-earnings.js", /<script src="assets\/js\/admin-earnings\.js\?v=[\d.]+"><\/script>/.test(payments));
  check("admin.html: member modal has the earnings block and the ledger", /id="mm-earn"/.test(admin) && /id="mm-ledger"/.test(admin) && /How this member earned/.test(admin));
  check("admin.html: payment rows carry the button", /earnButton\(r\)/.test(admin) && (admin.match(/earnButton\(r\)/g) || []).length >= 2);
  check("admin.html: the button opens the member with that request", /closest\("\[data-ffe-open\]"\)/.test(admin) && /openEarnings\(eb\.getAttribute\("data-ffe-open"\)\)/.test(admin));
  check("admin.html: asks the admin RPC", /rpc\("admin_member_earnings"/.test(admin));
  check("admin.html: an open member modal refreshes after approve / reject", /classList\.contains\("open"\)\) loadMemberDetail\(currentMember\)/.test(admin));
  check("admin-payments.html: rows carry the button (server mode only)", /FF\.hasServer\(\) \? FFEarnings\.buttonHtml\(r\.id\)/.test(payments) && (payments.match(/earnBtn\(r\)/g) || []).length >= 2);
  check("admin-payments.html: opens and refreshes the window", /FFEarnings\.open\(\{ rpc: FF\.rpc, request: id/.test(payments) && /FFEarnings\.refresh\(\)/.test(payments));
  check("RUN-ORDER.md lists the SQL file", read("RUN-ORDER.md").includes(SQL_FILE));
  check("README.md documents the feature", read("README.md").includes(SQL_FILE) && /How earned/.test(read("README.md")));
  check("package.json runs this test", read("package.json").includes("tests/admin-earnings.test.js"));

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 3] Summary — request, sources, balance check");
  const u = browser("<!doctype html><html><head></head><body><button id='opener'>row</button><div id='out'></div><div id='led'></div></body></html>",
    "https://example.test/unit.html");
  u.window.eval(js);
  const E = u.window.FFEarnings;
  const out = u.doc.getElementById("out");
  const show = (d, opts) => { out.innerHTML = E.summaryHtml(d, opts); return flat(out); };

  check("Module exports its API", !!E && ["summaryHtml", "mountLedger", "rows", "open", "refresh", "close", "isOpen", "buttonHtml", "isMissing"]
    .every((k) => typeof E[k] === "function"));
  check("Constants match the SQL file", E.RPC === "admin_member_earnings" && E.SQL_FILE === SQL_FILE && E.LIMIT === 300 && E.MAX === 5000);

  out.innerHTML = E.buttonHtml(REQ.id);
  check("Button carries the request id", out.querySelector("button.ffe-open[data-ffe-open='" + REQ.id + "']") !== null && /How earned/.test(out.textContent));
  check("A demo-mode request (browser id) gets no button", E.buttonHtml("req_ab12cd") === "" && E.buttonHtml("") === "" && E.buttonHtml(null) === "");
  out.innerHTML = E.buttonHtml('"><img src=x onerror=alert(1)>');
  check("Button never renders an untrusted id", out.innerHTML === "");

  let t = show(payload());
  check("Request card: amount, fee and status", /Withdrawal request · \$10\.00 pending/.test(t) && /member receives \$9\.90 after the \$0\.10 fee/.test(t) && /BEP20 \(BSC\)/.test(t));
  check("Request card: Approve / Reject use the page's own hooks",
    out.querySelector(".ffe-req [data-ok='" + REQ.id + "']") !== null && out.querySelector(".ffe-req [data-no='" + REQ.id + "']") !== null);
  show(payload(), { actions: false });
  check("Request card: actions can be hidden", out.querySelector(".ffe-req") !== null && out.querySelector("[data-ok], [data-no]") === null);
  t = show(payload((d) => { d.request.status = "approved"; d.request.settledAt = d.request.at + 60000; d.request.adminNote = "paid"; }));
  check("A settled request shows no buttons", /approved/.test(t) && /member received \$9\.90/.test(t) && /note: paid/.test(t) && out.querySelector("[data-ok], [data-no]") === null);
  t = show(payload((d) => { d.request = null; }));
  check("No request → no request card", out.querySelector(".ffe-req") === null && /Money in/.test(t));
  t = show(payload((d) => { d.request = null; }), { request: queueRow() });
  check("The page's queue row is used when the payload has no request", /Withdrawal request · \$10\.00 pending/.test(t));

  t = show(payload());
  const stats = Array.from(out.querySelectorAll(".ffe-stat")).map((s) => flat(s));
  check("Stat cards: earned (net), deposited, withdrawn, waiting, available, coins",
    stats.join(" | ") === "$2.11 Earned (net) | $20.00 Deposited | $10.00 Withdrawn so far | $10.00 Waiting to withdraw | $1.86 Available now | 3,636 Coins", stats);
  check("Earned (net) is explained", /Earned \(net\) = tasks \+ streak \+ referrals \+ mining claims − rigs bought with USDT ± coin conversions\./.test(t));
  show(payload(), { balances: false });
  check("Balance stats can be hidden (admin.html shows its own)", out.querySelectorAll(".ffe-stat").length === 4);

  show(payload());
  const cards = out.querySelectorAll(".ffe-cols")[0].querySelectorAll(".ffe-card");
  const usdtCard = flat(cards[0]), coinCard = flat(cards[1]);
  const labelsOf = (card) => Array.from(card.querySelectorAll("tr:not(.ffe-group):not(.ffe-total) td:first-child b")).map((b) => b.textContent);
  check("USDT sources: money in, largest first", JSON.stringify(labelsOf(cards[0]).slice(0, 8)) === JSON.stringify([
    "Deposits approved", "Task Market tasks completed", "Task escrow refunded", "Coins converted to USDT", "Added by an admin",
    "Mining claimed to USDT", "Referral income", "Daily streak rewards"]), labelsOf(cards[0]));
  check("USDT sources: money out, largest first", JSON.stringify(labelsOf(cards[0]).slice(8)) === JSON.stringify([
    "Withdrawals paid", "Withdrawals waiting for approval", "Escrow for tasks this member posted", "Mining rigs bought with USDT",
    "USDT converted to coins", "Removed by an admin"]), labelsOf(cards[0]));
  check("USDT totals", /Money in \+\$33\.611/.test(usdtCard) && /Money out −\$31\.75/.test(usdtCard) && /In − out \$1\.861/.test(usdtCard), usdtCard);
  check("A tiny reward is not rounded away", /Daily streak rewards 1 day · [^+]*\+\$0\.001/.test(usdtCard));
  check("Entry counts read naturally", /Task Market tasks completed 2 tasks/.test(usdtCard) && /Deposits approved 1 deposit/.test(usdtCard));
  check("Coin sources and totals", /Coins in \+7,121 coins/.test(coinCard) && /Coins out −3,485 coins/.test(coinCard) && /In − out 3,636 coins/.test(coinCard) &&
    /Earned in the browser, then imported/.test(coinCard) && /Mining rigs bought with coins/.test(coinCard), coinCard);

  check("Balance check passes when the entries add up", out.querySelectorAll("[data-ffe-check='ok']").length === 1 &&
    out.querySelectorAll("[data-ffe-check='bad']").length === 0 && /Balance check passed — these entries add up to the available \$1\.861\./.test(usdtCard));
  t = show(payload((d) => { d.usdt.balance = 26.861; d.usdt.diff = 25; d.balance.usdt = 26.861; }));
  check("Balance the ledger cannot explain is flagged", out.querySelectorAll("[data-ffe-check='bad']").length === 1 &&
    /Balance check failed — \$25\.00 of the available \$26\.861 has no matching entry\. Check the ledger below before you approve\./.test(t));
  t = show(payload((d) => { d.usdt.diff = -4; }));
  check("Entries larger than the balance are flagged too", out.querySelectorAll("[data-ffe-check='bad']").length === 1 && /add up to \$4\.00 more than the available/.test(t));
  t = show(payload((d) => { d.usdt.diff = 0.0136; }));
  check("A few cents of rounding is not an alarm", out.querySelectorAll("[data-ffe-check='ok']").length === 1 && /rounding difference \$0\.0136/.test(t));
  t = show(payload((d) => { d.points.diff = 500; }));
  check("Coin difference is a soft note, never a failed check", out.querySelectorAll("[data-ffe-check='bad']").length === 0 &&
    /500 coins more than these entries\. Admin coin edits and campaign payout changes are not itemised\./.test(t));

  t = show(payload());
  check("Facts: what the locked amount is made of", /Locked \$11\.00 = \$10\.00 in 1 pending withdrawal \+ \$1\.00 task escrow/.test(t));
  check("Facts: mining is shown net of rigs", /Mining in USDT −\$3\.75 net \(\$1\.25 claimed − \$5\.00 rigs\)/.test(t));
  check("Facts: streak, invites, admin edits", /Daily streak day 1 \(best 1, 1 check-in\)/.test(t) && /Direct invites 1/.test(t) && /Admin balance edits 2/.test(t));
  const reqRows = Array.from(out.querySelectorAll(".ffe-card")).find((c) => /Deposits & withdrawals/.test(c.textContent)).querySelectorAll("tbody tr");
  check("Every deposit / withdrawal request is listed", reqRows.length === 6 && /6 requests/.test(t));
  check("The request under review is highlighted", reqRows[0].classList.contains("ffe-on") && /this request/.test(reqRows[0].textContent) &&
    Array.from(reqRows).filter((r) => r.classList.contains("ffe-on")).length === 1);
  check("Reject reasons are shown", /Address invalid/.test(t) && /TXID not found/.test(t));
  check("Who paid + whose activity paid referral income", /Task Market — who paid this member/.test(t) && /Bob/.test(t) && /bob@test\.dev/.test(t) &&
    /Referral income — whose activity paid it/.test(t) && /Carol/.test(t) && /L1 \$0\.30 \+ 221 coins · L2 \$0\.06/.test(t));
  const seen = [];
  show(payload(), { memberCell: (id, name, email) => { seen.push([id, name, email].join("|")); return "<i class='who'>" + name + "</i>"; } });
  check("Pages can turn those members into links", out.querySelectorAll("i.who").length === 3 &&
    seen.indexOf(BASE.payers[0].userId + "|Bob|bob@test.dev") === 0 && seen.length === 3, seen);

  t = show(payload((d) => {
    d.request = null; d.requests = []; d.payers = []; d.referral = { direct: 0, levels: [], downline: [] }; d.streak = null; d.adminEdits = 0;
    d.usdt = { rows: [], in: 0, out: 0, net: 0, balance: 0, diff: 0 };
    d.points = { rows: [], in: 0, out: 0, net: 0, balance: 0, diff: 0 };
    d.balance = { usdt: 0, locked: 0, points: 0, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0, miningUnclaimed: 0, miningClaimed: 0 };
    d.locked = { withdrawals: 0, withdrawCount: 0, escrow: 0, escrowJobs: 0 };
  }));
  check("A brand-new member renders without a negative zero", !/-0|−\$0\.00|−0 /.test(t) && /\$0\.00 Withdrawn so far/.test(t) && /\$0\.00 Waiting to withdraw/.test(t), t);
  check("…and says there is nothing yet", (t.match(/Nothing recorded yet\./g) || []).length === 4 && /Balance check passed/.test(t));
  check("Zero never formats as a negative", E.usd(-0) === "$0.00" && E.usd(0) === "$0.00" && E.fine(-0) === "$0.00" && E.pts(-0.2) === "0" && E.usd(-1.5) === "−$1.50");

  const evil = '<img src=x onerror="window.__pwned=1">';
  t = show(payload((d) => {
    d.member.name = evil; d.request.network = evil; d.request.adminNote = evil; d.request.address = evil;
    d.requests[0].network = evil; d.requests[0].adminNote = evil; d.requests[0].status = evil;
    d.payers[0].name = evil; d.payers[0].email = evil; d.referral.downline[0].name = evil; d.usdt.rows[0].key = evil;
  }));
  check("Member-supplied text is escaped", out.querySelector("img") === null && !u.window.__pwned && t.includes("<img src=x"));

  t = show(null, { loading: true, request: queueRow() });
  check("Loading state keeps the request card", /Withdrawal request · \$10\.00/.test(t) && /Loading earnings…/.test(t));
  const missing = Object.assign(new Error(MISSING_RPC.message), { status: 404 });
  t = show(null, { error: missing, request: queueRow() });
  check("SQL file not run → clear instruction, request still reviewable", /Run supabase-admin-member-earnings\.sql once in the Supabase SQL editor/.test(t) &&
    /Withdrawal request · \$10\.00/.test(t) && out.querySelector("[data-ok='" + REQ.id + "']") !== null);
  check("isMissing recognises PostgREST's answers", E.isMissing(missing) && E.isMissing(new Error(MISSING_RPC.message)) &&
    E.isMissing(new Error("function public.admin_member_earnings(uuid) does not exist")) &&
    !E.isMissing(new Error("Admins only")) && !E.isMissing(new Error("Failed to fetch")) && !E.isMissing(null));
  t = show(null, { error: new Error("Admins only <b>") });
  check("Other errors are shown as they are (escaped)", /Could not load the earnings breakdown: Admins only <b>/.test(t) && out.querySelector("b") === null);

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 4] Money ledger");
  const led = u.doc.getElementById("led");
  const rows = E.rows(payload());
  const ledgerRows = () => Array.from(led.querySelectorAll("tbody tr"));
  const chip = (key) => led.querySelector("[data-ffe-filter='" + key + "']");
  E.mountLedger(led, { rows: rows, total: BASE.ledgerTotal, server: true });
  check("Every entry is listed, newest first", ledgerRows().length === 27 && /Withdrawal to BEP20 \(BSC\)/.test(ledgerRows()[0].textContent) &&
    /All 27 entries, newest first/.test(flat(led)));
  check("Filter chips carry counts", flat(chip("all")) === "All · 27" && flat(chip("tasks")) === "Tasks · 6" && flat(chip("referral")) === "Referral · 5" &&
    flat(chip("streak")) === "Streak · 1" && flat(chip("mining")) === "Mining · 6" && flat(chip("cash")) === "Deposits & withdrawals · 6" && flat(chip("other")) === "Other · 3",
    Array.from(led.querySelectorAll("[data-ffe-filter]")).map(flat));
  const off = ledgerRows().filter((r) => r.classList.contains("ffe-off")).map((r) => flat(r.querySelector(".ffe-detail")));
  check("Entries that did not move the balance are greyed", off.length === 4 && off.some((n) => /\(rejected\)/.test(n)) && off.some((n) => /\(pending\)/.test(n)) &&
    off.some((n) => /^Paid Bob for/.test(n)), off);
  const amounts = ledgerRows().map((r) => flat(r.querySelector(".ffe-num")));
  check("Coins and USDT are never mixed up", amounts.indexOf("+5,000 coins") > -1 && amounts.indexOf("+880 coins") > -1 && amounts.indexOf("−470 coins") > -1 &&
    amounts.indexOf("+$20.00") > -1 && amounts.indexOf("+$0.001") > -1 && amounts.indexOf("−$5.00") > -1, amounts);
  chip("tasks").click();
  check("Tasks filter narrows the list", ledgerRows().length === 6 && chip("tasks").classList.contains("on") && chip("tasks").getAttribute("aria-pressed") === "true" &&
    ledgerRows().every((r) => /Task earning|Task escrow|Escrow refund|Paid from escrow/.test(r.textContent)));
  chip("mining").click();
  check("Mining filter shows claims, rigs and admin edits", ledgerRows().length === 6 && ledgerRows().every((r) => /Mining claim|Mining rig|Admin edit/.test(r.textContent)));
  chip("all").click();
  check("All shows everything again", ledgerRows().length === 27);

  /* "Load all" */
  let asked = 0, failNext = true;
  const all = payload((d) => {
    for (let i = 0; i < 40; i++) d.ledger.push({ at: d.ledger[d.ledger.length - 1].at - 1000 * (i + 1), src: "wallet", type: "referral", unit: "usdt", amount: 0.001, note: "L1 referral income · older " + i, status: "completed", counted: true });
    d.ledgerTotal = d.ledger.length;
  });
  E.mountLedger(led, { rows: rows, total: 67, server: true, loadAll: () => { asked++; if (failNext) { failNext = false; return Promise.reject(new Error("offline")); } return Promise.resolve(all); } });
  check("Says when only the latest entries are shown", /Showing the latest 27 of 67 entries\./.test(flat(led)) && flat(led.querySelector("[data-ffe-all]")) === "Load all");
  led.querySelector("[data-ffe-all]").click();
  check("Load all shows progress and cannot be double-clicked", led.querySelector("[data-ffe-all]").disabled && flat(led.querySelector("[data-ffe-all]")) === "Loading…");
  await tick(); await tick();
  check("A failed load offers a retry and keeps the rows", asked === 1 && flat(led.querySelector("[data-ffe-all]")) === "Retry — load all" && ledgerRows().length === 27);
  led.querySelector("[data-ffe-all]").click();
  await tick(); await tick();
  check("Load all replaces the list with every entry", asked === 2 && ledgerRows().length === 67 && led.querySelector("[data-ffe-all]") === null && /All 67 entries/.test(flat(led)));

  E.mountLedger(led, { rows: [
    { at: "2026-11-14T10:00:00Z", src: "mining", type: "buy", unit: "list", amount: 10, note: "Started a custom rig", status: "completed", counted: true },
    { at: "2026-11-14T09:00:00Z", src: "wallet", type: "adjust", unit: "points", amount: 5000, note: "Imported browser-earned points", status: "completed", counted: true }
  ], server: false });
  check("Fallback rows (no RPC) are marked as partial", /Latest entries only\. Run supabase-admin-member-earnings\.sql for the complete ledger\./.test(flat(led)) && ledgerRows().length === 2);
  check("A rig's list price is not shown as a USDT debit", /list price \$10\.00/.test(flat(ledgerRows()[0])) && !/[+−]\$10/.test(flat(ledgerRows()[0])) && /\+5,000 coins/.test(flat(ledgerRows()[1])));
  E.mountLedger(led, { rows: [], server: true });
  check("An empty ledger says so", /No coin or USDT entries recorded yet\./.test(flat(led)));
  E.mountLedger(led, { loading: true });
  check("Loading placeholder", /Loading the ledger…/.test(flat(led)) && led.querySelector("table") === null);
  E.mountLedger(led, { failed: true });
  check("A ledger that failed to load never reads as empty", /The ledger could not be loaded\./.test(flat(led)) && !/No coin or USDT/.test(flat(led)));

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 5] Standalone window (admin-payments.html)");
  const calls = [];
  const rpcOk = (name, args) => { calls.push({ name, args }); return Promise.resolve(payload()); };
  check("Does nothing without an RPC or an id", (await E.open({ request: REQ.id })) === undefined && (await E.open({ rpc: rpcOk })) === undefined && !E.isOpen());
  u.doc.getElementById("opener").focus();
  const opening = E.open({ rpc: rpcOk, request: REQ.id, row: queueRow() });
  const modal = u.doc.getElementById("ffe-modal");
  check("Opens at once with the request while the numbers load", E.isOpen() && modal.classList.contains("open") && modal.getAttribute("aria-hidden") === "false" &&
    u.doc.body.classList.contains("modal-open") && /Withdrawal request · \$10\.00/.test(flat(modal)) && /Loading earnings…/.test(flat(modal)) &&
    modal.querySelector("[data-ok]") === null);
  check("Dialog is labelled and takes focus", modal.querySelector("[role='dialog'][aria-modal='true'][aria-labelledby='ffe-title']") !== null &&
    u.doc.activeElement === modal.querySelector(".modal"));
  await opening;
  check("Asks the admin RPC for that request", calls.length === 1 && calls[0].name === "admin_member_earnings" &&
    JSON.stringify(calls[0].args) === JSON.stringify({ p_limit: 300, p_request: REQ.id }), calls);
  check("Shows the member, the breakdown and the ledger", flat(u.doc.getElementById("ffe-title")) === "Alice" && /alice@test\.dev · joined /.test(flat(u.doc.getElementById("ffe-sub"))) &&
    modal.querySelectorAll("[data-ffe-check='ok']").length === 1 && modal.querySelectorAll("#ffe-ledger tbody tr").length === 27 &&
    modal.querySelector(".ffe-req [data-ok='" + REQ.id + "']") !== null);
  await E.refresh();
  check("refresh() reads the numbers again", calls.length === 2 && E.isOpen());
  u.doc.dispatchEvent(new u.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape closes and returns focus to the row", !E.isOpen() && !modal.classList.contains("open") && !u.doc.body.classList.contains("modal-open") &&
    u.doc.activeElement === u.doc.getElementById("opener"));
  check("refresh() is a no-op once closed", (await E.refresh()) === undefined && calls.length === 2);

  await E.open({ rpc: rpcOk, user: MEMBER.id });
  check("Can be opened for a member without a request", JSON.stringify(calls[2].args) === JSON.stringify({ p_limit: 300, p_user: MEMBER.id }) && E.isOpen());
  modal.querySelector("[data-ffe-close]").click();
  check("Close button closes", !E.isOpen());
  await E.open({ rpc: rpcOk, request: REQ.id });
  modal.dispatchEvent(new u.window.MouseEvent("click", { bubbles: true }));
  check("Clicking the backdrop closes", !E.isOpen());

  /* a slow answer for one member must not overwrite the next member */
  let releaseSlow;
  const slow = new Promise((r) => { releaseSlow = r; });
  const first = E.open({ rpc: () => slow, request: REQ.id });
  await E.open({ rpc: () => Promise.resolve(payload((d) => { d.member.name = "Bob"; d.member.email = "bob@test.dev"; })), user: BASE.payers[0].userId });
  releaseSlow(payload());
  await first;
  check("A late answer for another member is ignored", flat(u.doc.getElementById("ffe-title")) === "Bob" && /bob@test\.dev/.test(flat(u.doc.getElementById("ffe-sub"))));
  E.close();

  await E.open({ rpc: () => Promise.reject(new Error(MISSING_RPC.message)), request: REQ.id, row: queueRow() });
  check("SQL file not run → instruction + the request can still be settled", /Run supabase-admin-member-earnings\.sql once/.test(flat(modal)) &&
    modal.querySelector(".ffe-req [data-ok='" + REQ.id + "']") !== null && /The ledger could not be loaded\./.test(flat(modal)));
  E.close();
  await E.open({ rpc: () => { throw new Error("boom"); }, request: REQ.id });
  check("An RPC that throws is reported, not uncaught", /Could not load the earnings breakdown: boom/.test(flat(modal)));
  E.close();
  check("No uncaught JS errors in the module", u.errors.length === 0, u.errors);
  u.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 6] admin.html — Payments → How earned → member modal");
  const A = { calls: [], missing: false, profiles: [{ id: MEMBER.id, email: MEMBER.email, display_name: "Alice", created_at: "2026-10-18T00:00:00Z" }],
    queue: { pending: [queueRow()], history: [{ id: BASE.requests[2].id, kind: "withdraw", email: MEMBER.email, amount: 10, status: "approved", settledAt: BASE.requests[2].settledAt }] },
    earn: payload() };
  const a = browser(inlined("admin.html"), "https://example.test/admin.html", (window) => {
    window.FF_SUPABASE_CONFIG = { url: "https://db.example.test", anonKey: "public-test-key" };
    window.FF_ADMIN_EMAILS = ["admin@example.test"];
    window.localStorage.setItem("ff_admin_session", JSON.stringify({ access_token: "test-token", user: { email: "admin@example.test" } }));
    window.fetch = (url, options) => {
      const uri = String(url);
      const args = options && options.body ? JSON.parse(options.body) : null;
      A.calls.push({ url: uri, args: args, auth: (options && options.headers && options.headers.Authorization) || "" });
      if (uri.includes("/rest/v1/profiles?")) return reply(A.profiles);
      if (uri.includes("/rest/v1/rpc/wallet_admin_queue")) return reply(A.queue);
      if (uri.includes("/rest/v1/rpc/wallet_admin_settle")) {
        A.queue = { pending: [], history: [{ id: REQ.id, kind: "withdraw", email: MEMBER.email, amount: 10, status: "approved", settledAt: Date.now() }].concat(A.queue.history) };
        A.earn = payload((d) => {
          d.request.status = "approved"; d.request.settledAt = Date.now(); d.requests[0].status = "approved";
          d.usdt.rows.forEach((r) => { if (r.key === "withdrawn") { r.amount = -20; r.count = 2; } });
          d.usdt.rows = d.usdt.rows.filter((r) => r.key !== "withdraw_pending");
          d.locked = { withdrawals: 0, withdrawCount: 0, escrow: 1, escrowJobs: 1 }; d.balance.locked = 1;
        });
        return reply(A.queue);
      }
      if (uri.includes("/rest/v1/rpc/admin_member_earnings")) return A.missing ? reply(MISSING_RPC, 404) : reply(A.earn);
      if (uri.includes("/rest/v1/balances?user_id=eq.")) return reply([{ user_id: MEMBER.id, usdt: 1.861, locked: 11, points: 3636 }]);
      if (uri.includes("/rest/v1/wallet_txns?")) return reply([
        { type: "adjust", amount: 5000, note: "Imported browser-earned points", status: "completed", at: "2026-11-14T09:00:00Z" },
        { type: "referral", amount: 220, ref_currency: "points", note: "L1 referral income · Mining claim as points", status: "completed", at: "2026-11-14T08:00:00Z" },
        { type: "earning", amount: 2, note: "Task approved: \"Follow my page\"", status: "completed", at: "2026-11-14T07:00:00Z" }]);
      if (uri.includes("/rest/v1/mining_ledger?")) return reply([
        { type: "claim", detail: "Claimed $0.8000 as 880 points", amount: 0.8, at: "2026-11-14T06:00:00Z" },
        { type: "buy", detail: "Started a custom rig", amount: 10, at: "2026-11-14T05:00:00Z" }]);
      return reply([]);
    };
  });
  const ad = a.doc;
  const earnCalls = () => A.calls.filter((c) => c.url.includes("/rpc/admin_member_earnings"));
  try {
    await waitFor(() => ad.querySelector("#a-pending [data-ffe-open]") && /alice@test\.dev/.test(ad.getElementById("t-members").textContent), "payments queue + members");
    check("Pending request row has the How earned button", ad.querySelectorAll("#a-pending tr").length === 1 &&
      ad.querySelector("#a-pending [data-ffe-open]").getAttribute("data-ffe-open") === REQ.id && /How earned/.test(ad.querySelector("#a-pending [data-ffe-open]").textContent));
    check("Settled history rows have it too", ad.querySelectorAll("#a-history [data-ffe-open]").length === 1);
    check("Nothing is fetched until the admin asks", earnCalls().length === 0);

    ad.querySelector("#a-pending [data-ffe-open]").click();
    check("The member modal opens straight away with the request", ad.getElementById("member-modal").classList.contains("open") &&
      flat(ad.getElementById("mm-name")) === "Alice" && /Withdrawal request · \$10\.00/.test(flat(ad.getElementById("mm-earn"))) && /Loading earnings…/.test(flat(ad.getElementById("mm-earn"))));
    await waitFor(() => ad.querySelector("#mm-earn [data-ffe-check]"), "earnings breakdown");
    const first6 = earnCalls()[0];
    check("One admin RPC call for that member and request", earnCalls().length === 1 &&
      JSON.stringify(first6.args) === JSON.stringify({ p_user: MEMBER.id, p_limit: 300, p_request: REQ.id }) && first6.auth === "Bearer test-token", first6);
    let mm = flat(ad.getElementById("mm-earn"));
    check("Breakdown is in the modal", ad.querySelectorAll("#mm-earn [data-ffe-check='ok']").length === 1 && /Task Market tasks completed/.test(mm) && /Money in \+\$33\.611/.test(mm) &&
      /Withdrawals waiting for approval/.test(mm) && /\$2\.11 Earned \(net\)/.test(mm));
    check("Approve / Reject sit next to the evidence", ad.querySelector("#mm-earn .ffe-req [data-ok='" + REQ.id + "']") !== null && ad.querySelector("#mm-earn .ffe-req [data-no='" + REQ.id + "']") !== null);
    check("The modal's own balance tiles are not repeated", ad.querySelectorAll("#mm-earn .ffe-stat").length === 4 && flat(ad.getElementById("mm-usdt")) === "$1.86" && flat(ad.getElementById("mm-locked")) === "$11.00");
    check("Ledger is mounted with the entry count in its title", ad.querySelectorAll("#mm-ledger tbody tr").length === 27 && flat(ad.getElementById("mm-ledger-title")) === "Money ledger — 27 entries");
    check("The raw logs are not read when the RPC works", !A.calls.some((c) => /\/rest\/v1\/(wallet_txns|mining_ledger)\?/.test(c.url)));
    const poster = Array.from(ad.querySelectorAll("#mm-earn [data-member]")).map((b) => b.getAttribute("data-member"));
    check("Task posters and invited members are links to those members", poster.length === 3 && poster[0] === BASE.payers[0].userId, poster);

    ad.querySelector("#mm-earn .ffe-req [data-ok]").click();
    await waitFor(() => /approved/.test(flat(ad.querySelector("#mm-earn .ffe-req"))) && !ad.querySelector("#mm-earn .ffe-req [data-ok]"), "modal refresh after approve");
    const settle = A.calls.find((c) => c.url.includes("/rpc/wallet_admin_settle"));
    check("Approve inside the modal settles that request", !!settle && JSON.stringify(settle.args) === JSON.stringify({ p_request: REQ.id, p_approve: true, p_note: "" }));
    mm = flat(ad.getElementById("mm-earn"));
    check("…then the modal and the queue show the new state", ad.querySelectorAll("#a-pending tr").length === 0 && /\$20\.00 Withdrawn so far/.test(mm) &&
      /\$0\.00 Waiting to withdraw/.test(mm) && !/Withdrawals waiting for approval/.test(mm) && !/-0\.00|−\$0\.00/.test(mm), mm.slice(0, 400));
    check("The refreshed call still names the request", earnCalls().length === 2 && earnCalls()[1].args.p_request === REQ.id);

    /* a member who is not among the loaded accounts: the request id alone is enough */
    ad.dispatchEvent(new a.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    ad.getElementById("member-modal").classList.remove("open");
    A.profiles = [];
    A.queue = { pending: [Object.assign(queueRow(), { email: "someone-else@test.dev", name: "Someone" })], history: [] };
    A.earn = payload();
    ad.getElementById("btn-refresh").click();
    await waitFor(() => ad.querySelector("#a-pending [data-ffe-open]") && /someone-else@test\.dev/.test(ad.getElementById("a-pending").textContent), "refreshed queue");
    const before = earnCalls().length;
    ad.querySelector("#a-pending [data-ffe-open]").click();
    await waitFor(() => ad.getElementById("member-modal").classList.contains("open") && ad.querySelector("#mm-earn [data-ffe-check]"), "modal for an unlisted member");
    const lookup = earnCalls()[before];
    check("Unlisted member: looked up by the request id", JSON.stringify(lookup.args) === JSON.stringify({ p_request: REQ.id, p_limit: 300 }), lookup);
    check("…and that answer is reused, not fetched twice", earnCalls().length === before + 1 && flat(ad.getElementById("mm-name")) === "Alice" &&
      /alice@test\.dev/.test(flat(ad.getElementById("mm-sub"))));
    ad.getElementById("member-modal").classList.remove("open");

    /* SQL file not installed */
    A.missing = true;
    A.profiles = [{ id: MEMBER.id, email: MEMBER.email, display_name: "Alice", created_at: "2026-10-18T00:00:00Z" }];
    A.queue = { pending: [queueRow()], history: [] };
    ad.getElementById("btn-refresh").click();
    await waitFor(() => /alice@test\.dev/.test(ad.getElementById("a-pending").textContent) && /alice@test\.dev/.test(ad.getElementById("t-members").textContent), "queue + members again");
    ad.querySelector("#a-pending [data-ffe-open]").click();
    await waitFor(() => /supabase-admin-member-earnings\.sql/.test(flat(ad.getElementById("mm-earn"))), "missing-RPC hint");
    mm = flat(ad.getElementById("mm-earn"));
    check("SQL not run: the modal still opens and names the file", ad.getElementById("member-modal").classList.contains("open") &&
      /Run supabase-admin-member-earnings\.sql once in the Supabase SQL editor/.test(mm) && /Withdrawal request · \$10\.00/.test(mm) &&
      ad.querySelector("#mm-earn .ffe-req [data-ok='" + REQ.id + "']") !== null);
    const fb = Array.from(ad.querySelectorAll("#mm-ledger tbody tr")).map(flat);
    check("SQL not run: ledger falls back to the latest raw entries", fb.length === 5 && /Latest entries only/.test(flat(ad.getElementById("mm-ledger"))) &&
      flat(ad.getElementById("mm-ledger-title")) === "Money ledger", fb);
    check("…with coins labelled as coins", fb.some((r) => /Imported browser-earned points \+5,000 coins/.test(r)) && fb.some((r) => /Mining claim as points \+220 coins/.test(r)) &&
      fb.some((r) => /Claimed \$0\.8000 as 880 points \+880 coins/.test(r)) && fb.some((r) => /Started a custom rig list price \$10\.00/.test(r)) &&
      fb.some((r) => /Task approved: "Follow my page" \+\$2\.00/.test(r)), fb);
  } catch (err) {
    check("admin.html flow ran to the end", false, String(err && err.message));
  }
  check("No uncaught JS errors on admin.html", a.errors.length === 0, a.errors);
  a.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[EARN 7] admin-payments.html");
  const P = { calls: [], missing: false, queue: { pending: [queueRow()], history: [] }, earn: payload(), prompts: 0 };
  const p = browser(inlined("admin-payments.html"), "https://example.test/admin-payments.html", (window) => {
    window.FF_SUPABASE_CONFIG = { url: "https://db.example.test", anonKey: "public-test-key" };
    window.FF_ADMIN_EMAILS = ["admin@example.test"];
    window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.prompt = () => { P.prompts++; return "No proof of earnings"; };
    const ls = window.localStorage;
    ls.setItem("ff_session", JSON.stringify("admin@example.test"));
    ls.setItem("ff_users", JSON.stringify([{ id: "u_admin", email: "admin@example.test", name: "Admin", credits: 0, earned: 0, spent: 0,
      activity: [], campaigns: [], refCode: "FF-ADMIN", joined: Date.now(), weekly: [] }]));
    ls.setItem("ff_auth", JSON.stringify({ accessToken: "member-token", refreshToken: "r", userId: "00000000-0000-4000-8000-00000000ad01",
      email: "admin@example.test", expiresAt: Date.now() + 3600e3 }));
    window.fetch = (url, options) => {
      const uri = String(url);
      const args = options && options.body && typeof options.body === "string" && /^\s*[{[]/.test(options.body) ? JSON.parse(options.body) : null;
      P.calls.push({ url: uri, args: args });
      if (uri.includes("/rest/v1/rpc/wallet_admin_queue")) return reply(P.queue);
      if (uri.includes("/rest/v1/rpc/wallet_admin_settle")) {
        P.queue = { pending: [], history: [{ id: REQ.id, kind: "withdraw", email: MEMBER.email, amount: 10, status: "rejected", settledAt: Date.now() }] };
        P.earn = payload((d) => { d.request.status = "rejected"; d.request.adminNote = args.p_note; d.request.settledAt = Date.now(); });
        return reply(P.queue);
      }
      if (uri.includes("/rest/v1/rpc/admin_member_earnings")) return P.missing ? reply(MISSING_RPC, 404) : reply(P.earn);
      if (uri.includes("/rest/v1/rpc/wallet_state")) return reply({ wallet: { available: 0, locked: 0, points: 0 }, config: {}, networks: [], categories: [], txns: [], requests: [] });
      return reply([]);
    };
  });
  const pd = p.doc;
  const pEarn = () => P.calls.filter((c) => c.url.includes("/rpc/admin_member_earnings"));
  try {
    await waitFor(() => pd.querySelector("#a-pending [data-ffe-open]"), "payments page queue");
    check("Pending request row has the How earned button", pd.querySelectorAll("#a-pending tr").length === 1 &&
      pd.querySelector("#a-pending [data-ffe-open]").getAttribute("data-ffe-open") === REQ.id);
    check("…and the panel explains what it is for", !pd.getElementById("a-earn-hint").classList.contains("hidden") && /How earned/.test(flat(pd.getElementById("a-earn-hint"))));
    pd.querySelector("#a-pending [data-ffe-open]").click();
    const win = await waitFor(() => pd.querySelector("#ffe-modal.open [data-ffe-check]") && pd.getElementById("ffe-modal"), "earnings window");
    check("Opens the earnings window for that request", pEarn().length === 1 && JSON.stringify(pEarn()[0].args) === JSON.stringify({ p_limit: 300, p_request: REQ.id }), pEarn()[0]);
    let w = flat(win);
    check("Shows member, request, breakdown, balances and ledger", flat(pd.getElementById("ffe-title")) === "Alice" && /Withdrawal request · \$10\.00 pending/.test(w) &&
      /\$1\.86 Available now/.test(w) && /3,636 Coins/.test(w) && win.querySelectorAll("[data-ffe-check='ok']").length === 1 && win.querySelectorAll("#ffe-ledger tbody tr").length === 27);
    win.querySelector(".ffe-req [data-no]").click();
    await waitFor(() => /rejected/.test(flat(win.querySelector(".ffe-req"))) && !win.querySelector(".ffe-req [data-no]"), "window refresh after reject");
    const pSettle = P.calls.find((c) => c.url.includes("/rpc/wallet_admin_settle"));
    check("Reject inside the window settles with the reason", P.prompts === 1 && !!pSettle &&
      JSON.stringify(pSettle.args) === JSON.stringify({ p_request: REQ.id, p_approve: false, p_note: "No proof of earnings" }), pSettle);
    check("…then the window and the queue refresh", pEarn().length === 2 && /note: No proof of earnings/.test(flat(win)) && pd.querySelectorAll("#a-pending tr").length === 0 &&
      pd.querySelectorAll("#a-history [data-ffe-open]").length === 1);
    pd.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape closes the window", !win.classList.contains("open"));

    P.missing = true;
    pd.querySelector("#a-history [data-ffe-open]").click();
    await waitFor(() => /supabase-admin-member-earnings\.sql/.test(flat(win)), "missing-RPC hint on the payments page");
    check("SQL not run: the window explains what to run", win.classList.contains("open") && /Run supabase-admin-member-earnings\.sql once in the Supabase SQL editor/.test(flat(win)) &&
      /Withdrawal request · \$10\.00 rejected/.test(flat(win)));
  } catch (err) {
    check("admin-payments.html flow ran to the end", false, String(err && err.message));
  }
  check("No uncaught JS errors on admin-payments.html", p.errors.length === 0, p.errors);
  p.window.close();

  console.log("\n===============================================================");
  console.log(` ADMIN EARNINGS TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
