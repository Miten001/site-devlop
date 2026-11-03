/* =========================================================================
   FlexFam — money rounding + English copy tests
   -------------------------------------------------------------------------
   Reported bug (25 Jul):
     "Need 1.20 USDT — you have 1.20" on mining.html, and
     "Need 0.67 USDT — you have 0.67" for another member.

   Cause: balances keep up to 8 decimals (1.1996) while every page shows them
   rounded to 2 ("$1.20"). The strict "<" comparison rejected the purchase and
   the error message rounded both sides, printing the same amount twice.

   These tests lock in:
     1. cent-precision helpers (W.enough / W.debit / W.cents)
     2. buying a rig / withdrawing / converting / posting a task with a
        balance that only displays as the exact price
     3. the SQL functions compare and debit the same way
     4. the whole site's user-facing copy is English (no Hinglish leftovers)
   ========================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

/* ---------- fake browser (same shape as tests/reconcile.test.js) ---------- */
const elements = {};
function fakeEl(selector) {
  if (!elements[selector]) {
    elements[selector] = {
      selector, textContent: "", innerHTML: "", style: {}, value: "",
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, append() {}, remove() {}, addEventListener() {},
      dataset: {}, querySelectorAll: () => [],
    };
  }
  return elements[selector];
}
const domListeners = {};
global.window = global;
global.document = {
  addEventListener: (ev, fn) => { (domListeners[ev] = domListeners[ev] || []).push(fn); },
  querySelectorAll: (sel) => [fakeEl(sel)],
  querySelector: (sel) => fakeEl(sel),
  getElementById: (id) => fakeEl("#" + id),
  createElement: () => fakeEl("#dyn-" + Math.random()),
  body: { hasAttribute: () => false, appendChild() {}, style: {} },
};
global.localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.location = { pathname: "/mining.html", search: "", href: "" };
Object.defineProperty(global, "navigator", { value: { language: "en-IN", userAgent: "test" }, configurable: true });
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.IntersectionObserver = class { observe() {} unobserve() {} };
global.matchMedia = () => ({ matches: false });
window.addEventListener = () => {};
Object.defineProperty(global, "crypto", {
  value: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 1e9); return a; } },
  configurable: true,
});
global.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") });

require(path.join(ROOT, "assets/js/main.js"));
require(path.join(ROOT, "assets/js/wallet.js"));
require(path.join(ROOT, "assets/js/mining.js"));
(domListeners.DOMContentLoaded || []).forEach((fn) => { try { fn(); } catch (e) {} });

const FF = window.FF;
const W = FF.W;
const M = window.FF.M;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : "")); }
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/* Browser-only mode: no Supabase session, so every action runs the local
   ledger — exactly what the reported members hit on GitHub Pages. */
function localUser(email, wallet) {
  FF.store.set("ff_auth", null);
  FF.store.set("ff_session", email);
  FF.store.set("ff_users", [{
    name: "Test Member", email, memberId: "FF-TEST", credits: 0, earned: 0, spent: 0,
    activity: [], campaigns: [], refCode: "FF-TEST-0001", joined: Date.now(), weekly: [],
  }]);
  FF.store.set("ff_wallets", {
    [email]: {
      available: wallet, locked: 0, totalEarned: wallet, totalDeposited: 0,
      totalWithdrawn: 0, txns: [],
    },
  });
}

async function main() {
  console.log("\n[1] cent-precision helpers");
  check("W.cents rounds to the value the UI shows", W.cents(1.1996) === 120, W.cents(1.1996));
  check("$1.1996 shown as $1.20 can afford a $1.20 price", W.enough(1.1996, 1.2) === true);
  check("$1.1949 (shown as $1.19) cannot afford $1.20", W.enough(1.1949, 1.2) === false);
  check("a real shortfall still fails", W.enough(0.5, 1.2) === false);
  check("exact balance is enough", W.enough(1.2, 1.2) === true);
  check("debit clamps at zero instead of going negative", W.debit(1.1996, 1.2) === 0, W.debit(1.1996, 1.2));
  check("debit leaves the surplus when the balance is larger", W.debit(5, 1.2) === 3.8, W.debit(5, 1.2));

  console.log("\n[2] mining: buy a $5 rig with a wallet that displays $5.00");
  localUser("miner@test.dev", 4.9996);
  let bought = null, buyErr = null;
  try { bought = await M.api.buyPlan("bronze", "usdt"); } catch (e) { buyErr = e; }
  check("the purchase no longer throws 'Need $5.00 — you have $5.00'", !buyErr, buyErr && buyErr.message);
  check("rig is running", !!(bought && bought.contracts && bought.contracts.length), bought && bought.contracts);
  check("wallet is empty (clamped, never negative)", W.wallet("miner@test.dev").available === 0, W.wallet("miner@test.dev").available);

  console.log("\n[3] mining: a real shortfall keeps a clear English message");
  localUser("poor@test.dev", 1.18);
  let shortErr = null;
  try { await M.api.buyPlan("bronze", "usdt"); } catch (e) { shortErr = e; }
  check("shortfall is rejected", !!shortErr, shortErr && shortErr.message);
  check("message names both amounts", !!shortErr && /Need \$5\.00/.test(shortErr.message) && /\$1\.18/.test(shortErr.message), shortErr && shortErr.message);
  check("message stays English", !!shortErr && !/thoda|likho|nahi|karo|hai\b/i.test(shortErr.message), shortErr && shortErr.message);
  check("balance untouched after the rejection", W.wallet("poor@test.dev").available === 1.18, W.wallet("poor@test.dev").available);

  console.log("\n[4] wallet: withdraw the exact amount the page shows");
  localUser("withdraw@test.dev", 9.9996);   /* page shows $10.00, real balance is short by 0.0004 */
  let wd = null, wdErr = null;
  try { wd = W.createWithdraw("withdraw@test.dev", "Test Member", 10.0, "UPI", "tester@okaxis"); } catch (e) { wdErr = e; }
  check("$10.00 withdrawal accepted from a $9.9996 balance shown as $10.00", !wdErr && !!wd, wdErr && wdErr.message);
  check("balance clamped at zero", W.wallet("withdraw@test.dev").available === 0, W.wallet("withdraw@test.dev").available);

  console.log("\n[5] wallet: convert USDT -> points at the displayed amount");
  localUser("convert@test.dev", 1.1996);
  let points = null, convErr = null;
  try { points = W.convertUsdt("convert@test.dev", 1.2); } catch (e) { convErr = e; }
  check("$1.20 conversion accepted from a $1.1996 balance", !convErr && points === 1200, convErr && convErr.message || points);
  check("USDT balance clamped at zero", W.wallet("convert@test.dev").available === 0, W.wallet("convert@test.dev").available);

  console.log("\n[6] task market: escrow $1.20 from a $1.1996 balance");
  localUser("poster@test.dev", 1.1996);
  let job = null, jobErr = null;
  try {
    job = W.postJob("poster@test.dev", "Poster", {
      title: "Follow our new channel", description: "Follow the channel and send a screenshot of the followed state.",
      reward: 0.57, slots: 2, category: "social", url: "https://t.me/example",
    });
  } catch (e) { jobErr = e; }
  /* 0.57 x 2 = 1.14 budget + 5% fee (0.06) = $1.20 */
  check("task posted for $1.20 total", !jobErr && !!job, jobErr && jobErr.message);
  check("wallet clamped at zero", W.wallet("poster@test.dev").available === 0, W.wallet("poster@test.dev").available);

  console.log("\n[7] SQL functions use the same cent-precision rule");
  const miningSql = read("supabase-mining.sql");
  const walletSql = read("supabase-wallet.sql");
  const postSql = read("supabase-post-task-admin.sql");
  const patchSql = read("supabase-fix-balance-rounding.sql");
  check("mining_charge compares cents", /round\(bal\.usdt, 2\) < round\(p_price, 2\)/.test(miningSql));
  check("mining_charge no longer compares raw decimals", !/if bal\.usdt < p_price then/.test(miningSql));
  check("mining debit is clamped at zero", /greatest\(0, round\(usdt - p_price, 8\)\)/.test(miningSql));
  check("withdraw compares cents", /round\(p_amount, 2\) > round\(bal\.usdt, 2\)/.test(walletSql));
  check("USDT -> points compares cents", /round\(v_amount, 2\) > round\(bal\.usdt, 2\)/.test(walletSql));
  check("task escrow compares cents", /round\(bal\.usdt, 2\) < round\(v_total, 2\)/.test(walletSql));
  check("admin task edit compares cents", /round\(bal\.usdt, 2\) < round\(v_diff, 2\)/.test(postSql));
  check("one-file patch repeats all five functions",
    ["mining_charge", "wallet_create_withdraw", "wallet_convert_usdt", "jobs_post", "admin_jobs_update"]
      .every((fn) => new RegExp("create or replace function public\\." + fn + "\\b").test(patchSql)));

  console.log("\n[8] user-facing copy is English across the site");
  const HINGLISH = /\b(karo|kro|krna|krne|karein|kijiye|dijiye|karna|karne|karke|kiya|kiye|nahi|nahin|kaise|kyun|apna|apni|apne|aapka|aapki|aapke|jaldi|abhi|paise|milega|hoga|hogi|hain|liye|wala|wali|wale|thoda|jyada|zyada|bhejo|bheje|bhejte|dekho|dikhe|dikhta|dikhte|dikhega|chahiye|sakte|sakta|likho|padega|padegi|rahega|rahegi|yeh|woh|yahan|wahan|jaise|warna|kyunki|isliye|lekin|magar|upar|neeche|poora|puri)\b/i;
  function userFacingLines(file) {
    const raw = read(file);
    const noComments = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    return noComments.split("\n")
      .map((line, i) => ({ no: i + 1, text: line }))
      .filter((row) => !row.text.trim().startsWith("//"))
      .filter((row) => HINGLISH.test(row.text));
  }
  const pages = ["index.html", "landing.html", "login.html", "signup.html", "dashboard.html", "earn.html",
    "add.html", "post-task.html", "my-tasks.html", "tasks.html", "mining.html", "wallet.html",
    "refer.html", "admin.html", "admin-payments.html", "admin-check.html", "banner.html", "ads.html", "download.html"];
  pages.forEach((page) => {
    const hits = userFacingLines(page);
    check(page + " has no Hinglish copy", hits.length === 0, hits.slice(0, 3));
  });
  ["assets/js/main.js", "assets/js/wallet.js", "assets/js/mining.js", "assets/js/campaigns.js",
    "assets/js/proof.js", "assets/js/bell.js", "assets/js/support.js", "assets/js/message-view.js"]
    .forEach((js) => {
      const hits = userFacingLines(js);
      check(js + " has no Hinglish copy", hits.length === 0, hits.slice(0, 3));
    });

  console.log("\n===============================================================");
  console.log(" MONEY ROUNDING TESTS: " + pass + " PASSED, " + fail + " FAILED");
  console.log("===============================================================");
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("HARNESS ERROR", err); process.exit(2); });
