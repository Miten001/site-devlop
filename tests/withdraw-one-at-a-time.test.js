/* =========================================================================
   FlexFam — "one withdrawal at a time" tests
   -------------------------------------------------------------------------
   Requirement: a member can have only one withdrawal waiting for approval.
   The next one can be requested after the admin has approved it (or
   rejected it, which returns the money).

   Covers
     1. the SQL rule in wallet_create_withdraw() — same body in all three
        files, checked after the balance lock, nothing else touched
     2. server and browser word the refusal identically
     3. assets/js/wallet.js in browser-only mode
     4. wallet.html, server mode — the form is replaced by a pending card
     5. wallet.html, server mode — a tab that has not seen the request yet
     6. wallet.html — "Check status" on the pending card
     7. wallet.html, server mode — older accounts with several pending
        requests, and what does not block
     8. wallet.html, browser-only mode
     9. wiring — cache-busting and docs

   No network / Supabase credentials required: server mode talks to a small
   in-memory stand-in that answers like wallet_state() and
   wallet_create_withdraw().
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
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
/* Visible text with one space between pieces (textContent glues cells). */
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const PATCH = "supabase-withdraw-one-at-a-time.sql";
const SQL_FILES = ["supabase-wallet.sql", "supabase-fix-balance-rounding.sql", PATCH];
const NET = "BEP20 (BSC)";
const ADDR = "0xa1b2c3d4e5a1b2c3d4e5a1b2c3d4e5a1b2c3d4e5";
const EMAIL = "member@example.test";

/* ---------- SQL helpers ---------- */
function withdrawFn(file) {
  const sql = read(file);
  const start = sql.indexOf("create or replace function public.wallet_create_withdraw");
  if (start < 0) return null;
  const open = sql.indexOf("as $$", start) + 5;
  const close = sql.indexOf("$$;", open);
  return { head: sql.slice(start, open), body: sql.slice(open, close), rest: sql.slice(0, start) + sql.slice(close + 3) };
}
const noComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/* The two refusals exactly as plpgsql prints them: every "%" in the format
   string is replaced, in order, by the next argument. */
const BODY = (withdrawFn("supabase-wallet.sql") || { body: "" }).body;
const FORMATS = (BODY.match(/raise exception '(You already have[^']*)'/g) || []).map((m) => m.replace(/^raise exception '/, "").replace(/'$/, ""));
function plFormat(fmt, args) { let i = 0; return fmt.replace(/%/g, () => String(args[i++])); }
function serverRefusal(open) {
  const total = open.reduce((s, r) => s + Number(r.amount), 0).toFixed(2);     /* round(v_open_amt, 2) */
  return open.length === 1 ? plFormat(FORMATS[0] || "", [total]) : plFormat(FORMATS[1] || "", [open.length, total]);
}

/* ---------- browser ---------- */
/* Inline local scripts so jsdom runs them. supabase-config.js is left out:
   every test supplies its own config and must never see the live project. */
function inlined(file) {
  return read(file).replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const rel = src.split("?")[0];
    if (/supabase-config\.js$/.test(rel) || !exists(rel)) return "";
    return "<script>" + read(rel) + "<\/script>";
  });
}
const WALLET_PAGE = inlined("wallet.html");

function browser(setup) {
  const errors = [], confirms = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));
  const dom = new JSDOM(WALLET_PAGE, {
    url: "https://example.test/wallet.html#withdraw",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = (message) => { confirms.push(String(message)); return true; };
      window.prompt = () => "";
      window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      setup(window);
    }
  });
  const window = dom.window, doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const page = {
    window, doc, errors, confirms, $,
    W: () => window.FF.W,
    reported: [],
    /* Error toasts are sent to the admin error log unless the caller opts out. */
    watchReports() { window.FFA = window.FFA || {}; window.FFA.trackError = (message) => { page.reported.push(String(message)); }; },
    formShown: () => !$("wd-open").classList.contains("hidden"),
    cardShown: () => !$("wd-pending").classList.contains("hidden"),
    card: () => flat($("wd-pending")),
    toasts: () => Array.from(doc.querySelectorAll(".toast")).map(flat),
    tab: () => (doc.querySelector(".tab-pane.active") || {}).id,
    fill(amount, address) {
      $("wd-address").value = address === undefined ? ADDR : address;
      $("wd-amount").value = String(amount);
      $("wd-amount").dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    submit() { doc.querySelector('#wd-form button[type="submit"]').click(); },
    close() { window.close(); }
  };
  return page;
}

const memberRow = () => ({ id: "u_member", name: "Test Member", email: EMAIL, memberId: "FF-TEST", credits: 0, earned: 0, spent: 0,
  activity: [], campaigns: [], refCode: "FF-TEST-0001", joined: Date.now(), weekly: [] });

/* ---------- in-memory stand-in for the Supabase project ---------- */
function makeServer(available) {
  const S = { available: available, locked: 0, withdrawn: 0, requests: [], calls: [], seq: 0, down: false };
  S.state = () => ({
    server: true, now: Date.now(),
    config: { minDeposit: 10, minWithdraw: 10, withdrawFeePct: 1, platformFeePct: 10, minUsdtConvert: 1, minPointsConvert: 1000, minJobReward: 0.02, pointsPerUsdt: 1000 },
    networks: [
      { network: NET, deposit: true, withdraw: true, address: "0x1111111111111111111111111111111111111111", qr: "", note: "" },
      { network: "UPI", deposit: true, withdraw: true, address: "flexfam@upi", qr: "", note: "" }
    ],
    categories: [],
    wallet: { available: S.available, locked: S.locked, points: 0, totalEarned: 0, totalDeposited: 60, totalWithdrawn: S.withdrawn },
    txns: [],
    requests: S.requests.slice().sort((a, b) => b.at - a.at)
  });
  S.add = (kind, amount, status, extra) => {
    const fee = kind === "withdraw" ? Math.round(amount) / 100 : 0;
    const r = Object.assign({ id: "req-" + (++S.seq), kind: kind, amount: amount, fee: fee, receive: kind === "withdraw" ? Math.round((amount - fee) * 100) / 100 : null,
      network: NET, txid: kind === "deposit" ? "0xabcdef0123456789" : null, address: kind === "withdraw" ? ADDR : null, status: status || "pending", at: Date.now() + S.seq }, extra || {});
    S.requests.push(r);
    if (kind === "withdraw" && r.status === "pending") { S.available = Math.round((S.available - amount) * 100) / 100; S.locked = Math.round((S.locked + amount) * 100) / 100; }
    return r;
  };
  S.open = () => S.requests.filter((r) => r.kind === "withdraw" && r.status === "pending");
  /* The admin approves / rejects the oldest pending withdrawal. */
  S.settle = (approve) => {
    const r = S.open()[0];
    if (!r) return false;
    r.status = approve ? "approved" : "rejected";
    S.locked = Math.round((S.locked - r.amount) * 100) / 100;
    if (approve) S.withdrawn += r.amount; else S.available = Math.round((S.available + r.amount) * 100) / 100;
    return true;
  };
  /* Same order as wallet_create_withdraw(): the pending check comes first. */
  S.withdraw = (args) => {
    const open = S.open();
    if (open.length) return { status: 400, body: { code: "P0001", details: null, hint: null, message: serverRefusal(open) } };
    if (!(args.p_amount >= 10)) return { status: 400, body: { code: "P0001", details: null, hint: null, message: "Minimum withdrawal is $10.00 USDT" } };
    S.add("withdraw", Number(args.p_amount), "pending", { network: args.p_network, address: args.p_address });
    return { status: 200, body: S.state() };
  };
  S.count = (fn) => S.calls.filter((c) => c.fn === fn).length;
  S.fetch = (url, options) => {
    if (S.down) return Promise.reject(new TypeError("Failed to fetch"));      /* dropped connection */
    const uri = String(url);
    const m = uri.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
    const args = options && typeof options.body === "string" && /^\s*[{[]/.test(options.body) ? JSON.parse(options.body) : {};
    let out = { status: 200, body: [] };
    if (m) {
      S.calls.push({ fn: m[1], args: args });
      if (m[1] === "wallet_state") out = { status: 200, body: S.state() };
      else if (m[1] === "wallet_create_withdraw") out = S.withdraw(args);
    }
    return Promise.resolve({
      ok: out.status < 400, status: out.status, headers: { get: () => "0-0/0" },
      text: () => Promise.resolve(JSON.stringify(out.body)), json: () => Promise.resolve(out.body)
    });
  };
  return S;
}

/* A signed-in member in server mode. */
async function serverPage(S) {
  const p = browser((window) => {
    window.FF_SUPABASE_CONFIG = { url: "https://db.example.test", anonKey: "public-test-key" };
    const ls = window.localStorage;
    ls.setItem("ff_session", JSON.stringify(EMAIL));
    ls.setItem("ff_users", JSON.stringify([memberRow()]));
    ls.setItem("ff_auth", JSON.stringify({ accessToken: "member-token", refreshToken: "r", userId: "00000000-0000-4000-8000-000000000001",
      email: EMAIL, expiresAt: Date.now() + 3600e3 }));
    window.fetch = S.fetch;
  });
  await waitFor(() => p.$("w-mode-pill").textContent === "Server-synced", "wallet.html in server mode");
  p.watchReports();
  return p;
}

/* A member without a server session: the browser-only wallet. */
async function localPage(storage) {
  const p = browser((window) => {
    const ls = window.localStorage;
    Object.keys(storage).forEach((k) => ls.setItem(k, storage[k]));
    window.fetch = () => Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
  });
  await waitFor(() => p.$("w-mode-pill").textContent === "This browser only", "wallet.html in browser-only mode");
  p.watchReports();
  return p;
}
const storageOf = (window) => { const o = {}; for (let i = 0; i < window.localStorage.length; i++) { const k = window.localStorage.key(i); o[k] = window.localStorage.getItem(k); } return o; };

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 1] SQL: wallet_create_withdraw() refuses a second pending withdrawal");
  const fns = SQL_FILES.map(withdrawFn);
  check("All three SQL files define wallet_create_withdraw", exists(PATCH) && fns.every(Boolean), SQL_FILES.filter((f, i) => !fns[i]));
  check("…with one and the same body (a later re-run of any of them keeps the rule)", fns.every((f) => f && f.body === fns[0].body && f.head === fns[0].head));
  check("Same signature and security settings as before", /wallet_create_withdraw\(p_amount numeric, p_network text, p_address text\)\s+returns jsonb language plpgsql security definer set search_path = public as \$\$$/.test(fns[0].head), fns[0].head);

  const body = fns[0].body;
  const at = {
    lock: body.indexOf("from public.balances where user_id = v_user for update"),
    check: body.search(/from public\.pay_requests\s+where user_id = v_user and kind = 'withdraw' and status = 'pending'/),
    refuse: body.indexOf("raise exception 'You already have"),
    minimum: body.indexOf("raise exception 'Minimum withdrawal"),
    insert: body.indexOf("insert into public.pay_requests"),
    debit: body.indexOf("update public.balances")
  };
  check("Counts the member's own pending withdrawals only", at.check > 0 && /select count\(\*\), coalesce\(sum\(amount\), 0\) into v_open, v_open_amt/.test(body), at);
  check("…after the balance row is locked, so two simultaneous requests cannot both pass", at.lock > 0 && at.lock < at.check, at);
  check("…and before any money moves or a request is created", at.refuse > at.check && at.refuse < at.minimum && at.refuse < at.debit && at.refuse < at.insert, at);
  check("Two refusals (one request / several), both member-facing P0001 errors", FORMATS.length === 2 &&
    (body.match(/raise exception 'You already have[^;]*using errcode = 'P0001';/g) || []).length === 2 &&
    /if v_open = 1 then/.test(body) && /elsif v_open > 1 then/.test(body), FORMATS);
  check("Pending deposits are not part of the rule", !/kind = 'deposit'/.test(body) && !/kind in \(/.test(body));
  check("The earlier checks are still there", /round\(p_amount, 2\) > round\(bal\.usdt, 2\)/.test(body) && /Select a supported payout method/.test(body) &&
    /Enter a valid UPI ID/.test(body) && /Enter a valid USDT wallet address/.test(body) && /return public\.wallet_state\(\);/.test(body));

  const patch = read(PATCH);
  const outside = noComments(fns[2].rest);
  check("The patch file defines that one function and nothing else", (patch.match(/create or replace function/g) || []).length === 1 && !/create\s+(table|index|trigger|policy|type)/i.test(noComments(patch)));
  check("…and changes no table, balance or existing request", !/\b(insert|update|delete|truncate|drop|alter)\b/i.test(outside), outside.match(/\b(insert|update|delete|truncate|drop|alter)\b[^\n]*/i));
  check("…keeps it away from the anonymous role", /revoke all on function public\.wallet_create_withdraw\(numeric, text, text\) from public, anon;/.test(patch) &&
    /grant execute on function public\.wallet_create_withdraw\(numeric, text, text\) to authenticated;/.test(patch) && !/to anon\b/.test(outside));
  check("…stops with a clear message when the wallet is not installed, and reloads the API schema", /run supabase-mining\.sql and supabase-wallet\.sql first/.test(patch) && /notify pgrst, 'reload schema';/.test(patch));

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 2] Server and browser use the same words");
  const lp = await localPage({ ff_session: JSON.stringify(EMAIL), ff_users: JSON.stringify([memberRow()]),
    ff_wallets: JSON.stringify({ [EMAIL]: { available: 100, locked: 0, totalEarned: 100, totalDeposited: 0, totalWithdrawn: 0, txns: [] } }) });
  const W = lp.W();
  const oneOpen = [{ kind: "withdraw", status: "pending", amount: 12.46 }];
  const threeOpen = [{ kind: "withdraw", status: "pending", amount: 12.46 }, { kind: "withdraw", status: "pending", amount: 10.3 }, { kind: "withdraw", status: "pending", amount: 10.4 }];
  check("One pending: server message", serverRefusal(oneOpen) === "You already have a withdrawal of $12.46 waiting for approval. You can request the next one after it is approved.", serverRefusal(oneOpen));
  check("…and the browser says exactly the same", W.withdrawBlockedMessage(oneOpen) === serverRefusal(oneOpen), W.withdrawBlockedMessage(oneOpen));
  check("Several pending: server message", serverRefusal(threeOpen) === "You already have 3 withdrawals ($33.16 in total) waiting for approval. You can request the next one after they are approved.", serverRefusal(threeOpen));
  check("…and the browser says exactly the same", W.withdrawBlockedMessage(threeOpen) === serverRefusal(threeOpen), W.withdrawBlockedMessage(threeOpen));
  check("Whole-dollar amounts keep two decimals on both sides", serverRefusal([{ amount: 10 }]) === W.withdrawBlockedMessage([{ amount: 10 }]) && /\$10\.00 /.test(serverRefusal([{ amount: 10 }])));
  check("The page recognises both server refusals", W.isWithdrawBlocked(new Error(serverRefusal(oneOpen))) && W.isWithdrawBlocked(new Error(serverRefusal(threeOpen))));
  check("…and nothing else", !W.isWithdrawBlocked(new Error("Minimum withdrawal is $10.00 USDT")) && !W.isWithdrawBlocked(new Error("Not enough available balance — you have $0.00 USDT")) &&
    !W.isWithdrawBlocked(null) && !W.isWithdrawBlocked({}));
  check("openWithdrawals() keeps pending withdrawals only", W.openWithdrawals([
    { kind: "withdraw", status: "pending", amount: 1 }, { kind: "withdraw", status: "approved", amount: 2 }, { kind: "withdraw", status: "rejected", amount: 3 },
    { kind: "deposit", status: "pending", amount: 4 }, null
  ]).length === 1 && W.openWithdrawals(null).length === 0 && W.openWithdrawals(undefined).length === 0);

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 3] wallet.js, browser-only mode");
  const wallet = () => W.wallet(EMAIL);
  const snap = () => JSON.stringify([wallet().available, wallet().locked, wallet().txns.length, W.myRequests(EMAIL).length]);
  const attempt = (amount, net, addr) => { try { return { req: W.createWithdraw(EMAIL, "Test Member", amount, net || "UPI", addr || "tester@okaxis") }; } catch (e) { return { err: e.message }; } };

  try {
    let first = attempt(10);
    check("First withdrawal is accepted", !!first.req && first.req.status === "pending" && wallet().available === 90 && wallet().locked === 10, first.err);
    let before = snap();
    let second = attempt(10);
    check("A second one while it is pending is refused", second.err === "You already have a withdrawal of $10.00 waiting for approval. You can request the next one after it is approved.", second);
    check("…through another payout method too", /already have a withdrawal of \$10\.00/.test(attempt(15, NET, ADDR).err || ""));
    check("…and ahead of the other checks (a too-small amount gets the same answer)", /already have a withdrawal of \$10\.00/.test(attempt(1).err || ""));
    check("…and nothing moved: balance, locked, ledger and request list unchanged", snap() === before, [before, snap()]);

    W.settleRequest(first.req.id, true);
    check("Approved: the amount leaves the wallet", wallet().available === 90 && wallet().locked === 0 && wallet().totalWithdrawn === 10, wallet());
    let third = attempt(20);
    check("After approval the next withdrawal is accepted", !!third.req && wallet().available === 70 && wallet().locked === 20, third.err);
    check("…and blocks the one after it", /already have a withdrawal of \$20\.00/.test(attempt(10).err || ""));
    W.settleRequest(third.req.id, false);
    check("Rejected: the money is back", wallet().available === 90 && wallet().locked === 0, wallet());
    let fourth = attempt(90);
    check("After a rejection the member can request again", !!fourth.req && wallet().available === 0 && wallet().locked === 90, fourth.err);
    W.settleRequest(fourth.req.id, false);

    W.createDeposit(EMAIL, "Test Member", 25, NET, "0xabcdef0123456789abcdef");
    check("A pending deposit does not block a withdrawal", !!attempt(10).req);
    check("Deposits are never limited by the rule", (() => { try { W.createDeposit(EMAIL, "Test Member", 30, NET, "0xabcdef0123456789abcdee"); return true; } catch (e) { return e.message; } })() === true);

    W.patchWallet("other@example.test", (acc) => { acc.available = 50; });
    let otherErr = null;
    try { W.createWithdraw("other@example.test", "Other", 10, "UPI", "other@okaxis"); } catch (e) { otherErr = e.message; }
    check("Another member's withdrawal is not affected", otherErr === null, otherErr);

    /* Requests created before the rule existed: several pending at once. */
    const all = W.requests();
    all.unshift({ id: "wd_old1", kind: "withdraw", email: "legacy@example.test", amount: 12.46, fee: 0.12, receive: 12.34, network: NET, address: ADDR, status: "pending", at: Date.now() - 2 },
      { id: "wd_old2", kind: "withdraw", email: "legacy@example.test", amount: 10.3, fee: 0.1, receive: 10.2, network: NET, address: ADDR, status: "pending", at: Date.now() - 1 });
    lp.window.FF.store.set("ff_pay_requests", all);
    W.patchWallet("legacy@example.test", (acc) => { acc.available = 40; acc.locked = 22.76; });
    const legacy = () => { try { W.createWithdraw("legacy@example.test", "Legacy", 10, "UPI", "legacy@okaxis"); return null; } catch (e) { return e.message; } };
    check("Member with two older pending requests: refused, counted and totalled", legacy() === "You already have 2 withdrawals ($22.76 in total) waiting for approval. You can request the next one after they are approved.", legacy());
    W.settleRequest("wd_old1", true);
    check("…one settled: the other still blocks", /already have a withdrawal of \$10\.30/.test(legacy() || ""), legacy());
    W.settleRequest("wd_old2", true);
    check("…all settled: withdrawals work again", legacy() === null, legacy());
  } catch (err) { check("browser-only wallet flow ran to the end", false, String(err && err.message)); }
  check("No uncaught JS errors", lp.errors.length === 0, lp.errors);
  lp.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 4] wallet.html, server mode: the form gives way to a pending card");
  const S = makeServer(60);
  let p = await serverPage(S);
  try {
    check("No pending withdrawal: the form is shown, the card is not", p.formShown() && !p.cardShown() && p.tab() === "pane-withdraw");
    check("The rule is stated next to the form", /Only one withdrawal at a time : once you request one, you can request the next after it is approved\./.test(flat(p.doc.querySelector("#wd-open .warn-banner"))),
      flat(p.doc.querySelector("#wd-open .warn-banner")));
    p.fill("12.46");
    p.submit();
    await waitFor(() => p.tab() === "pane-requests" && S.open().length === 1, "withdrawal accepted");
    const sent = S.calls.filter((c) => c.fn === "wallet_create_withdraw");
    check("The request goes to the server once", sent.length === 1 && JSON.stringify(sent[0].args) === JSON.stringify({ p_amount: 12.46, p_network: NET, p_address: ADDR }) && p.confirms.length === 1, sent);
    check("Withdraw tab: the pending card replaces the form", p.cardShown() && !p.formShown());
    const c = p.card();
    check("Card says what is pending and when the next one is possible", /Pending Your withdrawal of \$12\.46 is waiting for approval/.test(c) &&
      /Only one withdrawal can be open at a time\. You can request the next one as soon as this one is approved\./.test(c), c);
    check("Card shows the request: method, address, amount, fee and payout", /Payout method BEP20 \(BSC\)/.test(c) && c.includes("Wallet address " + ADDR) &&
      /Amount \$12\.46/.test(c) && /You receive \(after the \$0\.12 fee\) \$12\.34/.test(c) && p.doc.querySelectorAll("#wd-pending .wd-pending-item").length === 1, c);
    check("Card explains a rejection and links to the request list", /If a request is rejected, the full amount returns to your available balance and you can request again\./.test(c) &&
      !!p.doc.querySelector('#wd-pending [data-goto="requests"]'), c);
    check("Balances follow the server", flat(p.$("w-available")) === "47.54 USDT" && flat(p.$("w-locked")) === "12.46 USDT", [flat(p.$("w-available")), flat(p.$("w-locked"))]);

    /* The form is hidden, but a submit that gets through anyway must not reach the server. */
    const sentBefore = S.count("wallet_create_withdraw");
    p.fill("10");
    p.$("wd-form").dispatchEvent(new p.window.Event("submit", { bubbles: true, cancelable: true }));
    await pause(60);
    check("A forced submit is stopped in the page: no confirm, no server call", S.count("wallet_create_withdraw") === sentBefore && p.confirms.length === 1, { calls: S.count("wallet_create_withdraw"), confirms: p.confirms.length });
    check("…with the explanation", p.toasts().includes("You already have a withdrawal of $12.46 waiting for approval. You can request the next one after it is approved."), p.toasts());
    check("…which is not filed as an application error", p.reported.length === 0, p.reported);
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("server-mode flow ran to the end", false, String(err && err.message)); }
  p.close();

  p = await serverPage(S);
  try {
    check("After a reload the card is still there and the form stays hidden", p.cardShown() && !p.formShown() && /Your withdrawal of \$12\.46 is waiting for approval/.test(p.card()));
  } catch (err) { check("reload ran to the end", false, String(err && err.message)); }
  p.close();

  S.settle(true);
  p = await serverPage(S);
  try {
    check("Admin approved it: the form is back", p.formShown() && !p.cardShown());
    p.$("wd-nets").querySelector('[data-net="UPI"]').click();
    p.fill("20", "member@okaxis");
    p.submit();
    await waitFor(() => p.tab() === "pane-requests" && S.open().length === 1, "second withdrawal accepted");
    check("…and the next withdrawal is accepted", S.open()[0].amount === 20 && S.open()[0].network === "UPI", S.open());
    check("The card now shows the UPI request", p.cardShown() && /Your withdrawal of \$20\.00 is waiting for approval/.test(p.card()) && /Payout method UPI/.test(p.card()) &&
      /UPI ID member@okaxis/.test(p.card()) && /You receive \(after the \$0\.20 fee\) \$19\.80/.test(p.card()), p.card());
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("approve flow ran to the end", false, String(err && err.message)); }
  p.close();

  S.settle(false);
  p = await serverPage(S);
  try {
    check("Admin rejected it: the form is back and the money is available again", p.formShown() && !p.cardShown() && flat(p.$("w-available")) === "47.54 USDT", flat(p.$("w-available")));
  } catch (err) { check("reject flow ran to the end", false, String(err && err.message)); }
  p.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 5] wallet.html, server mode: a tab that has not seen the request");
  const S2 = makeServer(60);
  p = await serverPage(S2);
  try {
    check("The tab was opened before any request: it shows the form", p.formShown() && !p.cardShown());
    S2.add("withdraw", 12.46, "pending");               /* requested from another tab or device */
    const statesBefore = S2.count("wallet_state");
    p.fill("10");
    p.submit();
    await waitFor(() => p.cardShown(), "stale tab switches to the card");
    check("The server refuses the second request", S2.count("wallet_create_withdraw") === 1 && S2.open().length === 1 && S2.available === 47.54, { open: S2.open().length, available: S2.available });
    check("The member reads the server's reason", p.toasts().includes("You already have a withdrawal of $12.46 waiting for approval. You can request the next one after it is approved."), p.toasts());
    check("…which is not filed as an application error", p.reported.length === 0, p.reported);
    check("The page reloads the wallet and shows the pending card", S2.count("wallet_state") === statesBefore + 1 && p.cardShown() && !p.formShown() &&
      /Your withdrawal of \$12\.46 is waiting for approval/.test(p.card()) && flat(p.$("w-locked")) === "12.46 USDT", { states: S2.count("wallet_state") - statesBefore, card: p.card() });
    await waitFor(() => !p.doc.querySelector('#wd-form button[type="submit"]').disabled, "submit button released");
    check("The submit button is released again", true);
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("stale-tab flow ran to the end", false, String(err && err.message)); }
  p.close();

  const S3 = makeServer(60);
  p = await serverPage(S3);
  try {
    const statesBefore = S3.count("wallet_state");
    p.fill("5");
    p.submit();
    await waitFor(() => p.toasts().length > 0, "validation error toast");
    await pause(60);
    check("Other server errors behave as before: shown, form kept, no reload", p.toasts().includes("Minimum withdrawal is $10.00 USDT") && p.formShown() && !p.cardShown() &&
      S3.count("wallet_state") === statesBefore && S3.open().length === 0, { toasts: p.toasts(), states: S3.count("wallet_state") - statesBefore });
    check("…and still reach the admin error log", p.reported.length === 1 && p.reported[0] === "Minimum withdrawal is $10.00 USDT", p.reported);
  } catch (err) { check("validation flow ran to the end", false, String(err && err.message)); }
  p.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 6] wallet.html: \"Check status\" on the pending card");
  const STILL = "Still waiting for approval.";
  const APPROVED = "Your withdrawal was approved. You can request the next one now.";
  const REJECTED = "Your withdrawal was rejected and the amount is back in your available balance. You can request again.";
  const REVIEWED = "Your withdrawals have been reviewed — see My requests. You can request the next one now.";
  const S5 = makeServer(60);
  S5.add("withdraw", 12.46, "pending");
  p = await serverPage(S5);
  try {
    const btn = p.$("wd-pending-refresh");
    check("The card has a Check status button", p.cardShown() && !!btn && flat(btn) === "Check status");
    const states = S5.count("wallet_state");
    btn.click();
    await waitFor(() => p.toasts().includes(STILL) && !btn.disabled, "still-waiting answer");
    check("Still pending: reads the wallet again, says so and keeps the card", S5.count("wallet_state") === states + 1 && p.cardShown() && !p.formShown(), { states: S5.count("wallet_state") - states });

    S5.settle(true);                                    /* the admin approves while the page is open */
    btn.click();
    await waitFor(() => p.formShown(), "form after approval");
    check("Approved meanwhile: the form is back without reloading the page", !p.cardShown() && p.toasts().includes(APPROVED) &&
      flat(p.$("w-locked")) === "0.00 USDT" && flat(p.$("w-available")) === "47.54 USDT", p.toasts());

    p.fill("20");
    p.submit();
    await waitFor(() => p.cardShown() && S5.open().length === 1, "second request");
    check("The next withdrawal goes through and the card is back", /Your withdrawal of \$20\.00 is waiting for approval/.test(p.card()), p.card());
    S5.settle(false);                                   /* …and this one is rejected */
    btn.click();
    await waitFor(() => p.formShown(), "form after rejection");
    check("Rejected meanwhile: says so, and the money is available again", !p.cardShown() && p.toasts().includes(REJECTED) && flat(p.$("w-available")) === "47.54 USDT", p.toasts());
    check("None of these answers is filed as an application error", p.reported.length === 0, p.reported);
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("Check status flow ran to the end", false, String(err && err.message)); }
  p.close();

  const S6 = makeServer(60);
  S6.add("withdraw", 12.46, "pending"); S6.add("withdraw", 10.3, "pending");
  p = await serverPage(S6);
  try {
    S6.settle(true);
    p.$("wd-pending-refresh").click();
    await waitFor(() => p.toasts().includes(STILL), "one of two still pending");
    check("Two older requests, one settled: still waiting, the card lists the one that is left", p.cardShown() && p.doc.querySelectorAll("#wd-pending .wd-pending-item").length === 1 &&
      /Your withdrawal of \$10\.30 is waiting for approval/.test(p.card()), p.card());
  } catch (err) { check("partly-settled check ran to the end", false, String(err && err.message)); }
  p.close();

  const S7 = makeServer(60);
  S7.add("withdraw", 12.46, "pending"); S7.add("withdraw", 10.3, "pending");
  p = await serverPage(S7);
  try {
    S7.settle(true); S7.settle(false);
    p.$("wd-pending-refresh").click();
    await waitFor(() => p.formShown(), "form after both are settled");
    check("Two older requests, one approved and one rejected: a neutral answer", p.toasts().includes(REVIEWED) && !p.toasts().includes(APPROVED) && !p.toasts().includes(REJECTED), p.toasts());
  } catch (err) { check("mixed check ran to the end", false, String(err && err.message)); }
  p.close();

  const S8 = makeServer(60);
  S8.add("withdraw", 12.46, "pending");
  p = await serverPage(S8);
  try {
    S8.down = true;
    p.$("wd-pending-refresh").click();
    await waitFor(() => p.$("w-mode-pill").textContent === "Offline fallback" && !p.$("wd-pending-refresh").disabled, "offline fallback");
    check("Server unreachable: the page says so and claims nothing about the request",
      p.toasts().includes("Could not reach the server, so the status was not checked. Reload the page to try again.") &&
      !p.toasts().some((t) => t === STILL || t === APPROVED || t === REJECTED || t === REVIEWED) && p.reported.length === 0, { toasts: p.toasts(), reported: p.reported });
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("offline check ran to the end", false, String(err && err.message)); }
  p.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 7] wallet.html, server mode: older accounts and what does not block");
  const S4 = makeServer(60);
  S4.add("withdraw", 12.46, "pending"); S4.add("withdraw", 10.3, "pending"); S4.add("withdraw", 10.4, "pending");
  p = await serverPage(S4);
  try {
    const c = p.card();
    check("Three older pending requests: counted, totalled and listed", p.cardShown() && !p.formShown() && /3 withdrawals \(\$33\.16 in total\) are waiting for approval/.test(c) &&
      /as soon as these are approved\./.test(c) && p.doc.querySelectorAll("#wd-pending .wd-pending-item").length === 3 &&
      /Amount \$12\.46/.test(c) && /Amount \$10\.30/.test(c) && /Amount \$10\.40/.test(c), c);
  } catch (err) { check("several-pending flow ran to the end", false, String(err && err.message)); }
  p.close();

  S4.settle(true); S4.settle(false);
  p = await serverPage(S4);
  try {
    check("Two of them settled: the last one still holds the form back", p.cardShown() && !p.formShown() && p.doc.querySelectorAll("#wd-pending .wd-pending-item").length === 1 &&
      /Your withdrawal of \$\d+\.\d\d is waiting for approval/.test(p.card()), p.card());
  } catch (err) { check("partly-settled flow ran to the end", false, String(err && err.message)); }
  p.close();

  S4.settle(true);
  S4.add("deposit", 25, "pending");
  p = await serverPage(S4);
  try {
    check("All settled (approved and rejected ones in the history) plus a pending deposit: the form is shown", p.formShown() && !p.cardShown() &&
      p.doc.querySelectorAll("#rq-body tr").length === 4);
    check("No uncaught JS errors", p.errors.length === 0, p.errors);
  } catch (err) { check("nothing-blocks flow ran to the end", false, String(err && err.message)); }
  p.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 8] wallet.html, browser-only mode");
  let l = await localPage({ ff_session: JSON.stringify(EMAIL), ff_users: JSON.stringify([memberRow()]),
    ff_wallets: JSON.stringify({ [EMAIL]: { available: 40, locked: 0, totalEarned: 40, totalDeposited: 0, totalWithdrawn: 0, txns: [] } }) });
  let saved = null;
  try {
    check("No pending withdrawal: the form is shown", l.formShown() && !l.cardShown());
    l.fill("15");
    l.submit();
    await waitFor(() => l.tab() === "pane-requests" && l.cardShown(), "local withdrawal accepted");
    check("After the request the card replaces the form", !l.formShown() && /Your withdrawal of \$15\.00 is waiting for approval/.test(l.card()) && /You receive \(after the \$0\.15 fee\) \$14\.85/.test(l.card()), l.card());
    l.fill("10");
    l.$("wd-form").dispatchEvent(new l.window.Event("submit", { bubbles: true, cancelable: true }));
    await pause(60);
    check("A forced second submit creates nothing", l.W().myRequests(EMAIL).length === 1 && l.W().wallet(EMAIL).available === 25 && l.W().wallet(EMAIL).locked === 15, l.W().wallet(EMAIL));
    l.$("wd-pending-refresh").click();
    await waitFor(() => l.toasts().includes("Still waiting for approval."), "local still-waiting answer");
    check("Check status while it is pending keeps the card", l.cardShown() && !l.formShown());
    l.W().settleRequest(l.W().myRequests(EMAIL)[0].id, true);
    l.$("wd-pending-refresh").click();
    await waitFor(() => l.formShown(), "local form after approval");
    check("Check status after approval brings the form back", !l.cardShown() && l.toasts().includes("Your withdrawal was approved. You can request the next one now."), l.toasts());
    saved = storageOf(l.window);
    check("No uncaught JS errors", l.errors.length === 0, l.errors);
  } catch (err) { check("browser-only flow ran to the end", false, String(err && err.message)); }
  l.close();
  if (saved) {
    l = await localPage(saved);
    try {
      check("Approved and reloaded: the form is back", l.formShown() && !l.cardShown() && flat(l.$("w-available")) === "25.00 USDT", flat(l.$("w-available")));
    } catch (err) { check("browser-only reload ran to the end", false, String(err && err.message)); }
    l.close();
  }

  /* ---------------------------------------------------------------- */
  console.log("\n[ONE 9] Wiring");
  const pages = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f));
  const versions = {};
  pages.forEach((f) => { const m = read(f).match(/assets\/js\/wallet\.js\?v=([0-9.]+)/); if (m) versions[f] = m[1]; });
  const distinct = Array.from(new Set(Object.values(versions)));
  check("Every page loads the same wallet.js version, newer than the one before this rule (2.4)", Object.keys(versions).length >= 11 && distinct.length === 1 && parseFloat(distinct[0]) > 2.4, versions);
  const html = read("wallet.html");
  check("wallet.html has the pending card and wraps the form it replaces", /id="wd-pending"/.test(html) && /id="wd-open"/.test(html) &&
    html.indexOf('id="wd-pending"') < html.indexOf('id="wd-open"') && html.indexOf('id="wd-open"') < html.indexOf('id="wd-form"'));
  check("The dashboard Withdraw button opens that tab", /href="wallet\.html#withdraw"/.test(read("dashboard.html")));
  const order = read("RUN-ORDER.md"), readme = read("README.md");
  check("RUN-ORDER.md lists the file as #25 and explains the rule", /\| 25 \| \[`supabase-withdraw-one-at-a-time\.sql`\]\(supabase-withdraw-one-at-a-time\.sql\)/.test(order) && /## One withdrawal at a time \(#25\)/.test(order), null);
  check("README.md documents the rule and the file", /one withdrawal at a time/i.test(readme) && /supabase-withdraw-one-at-a-time\.sql/.test(readme));
  check("npm test runs this file", /node tests\/withdraw-one-at-a-time\.test\.js/.test(read("package.json")));

  console.log("\n===============================================================");
  console.log(` ONE WITHDRAWAL AT A TIME TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
