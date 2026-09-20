/* Functional test harness: loads main.js, wallet.js, mining.js in a fake
   browser and reproduces the reported bug scenario (server-mode user whose
   browser-earned points/USDT used to zero out after the wallet_state
   response arrived). */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

/* ---------- fake browser ---------- */
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
global.location = { pathname: "/dashboard.html", search: "", href: "" };
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

/* Supabase config: valid, so memberConfig() passes (server mode possible) */
window.FF_SUPABASE_CONFIG = { url: "https://test-project.supabase.co", anonKey: "anon-test-key" };

/* ---------- RPC stub ----------
   Unknown rpc functions return 404, exactly like PostgREST does when the
   function is not installed — this keeps the auto-import path honest. */
let rpcResponses = {};   // fn -> payload | {__error, status}
let rpcCalls = [];
global.fetch = (url) => {
  const m = String(url).match(/\/rest\/v1\/rpc\/(\w+)/) || String(url).match(/\/auth\/v1\/(\w+)/);
  const fn = m ? m[1] : String(url);
  rpcCalls.push(fn);
  const resp = rpcResponses[fn];
  if (!resp) {
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(JSON.stringify({ message: "Could not find the function " + fn })) });
  }
  if (resp.__error) {
    return Promise.resolve({ ok: false, status: resp.status || 400, text: () => Promise.resolve(JSON.stringify({ message: resp.__error })) });
  }
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(resp)) });
};

require(path.join(ROOT, "assets/js/main.js"));
require(path.join(ROOT, "assets/js/wallet.js"));
require(path.join(ROOT, "assets/js/mining.js"));
(domListeners.DOMContentLoaded || []).forEach((fn) => { try { fn(); } catch (e) { console.log("  (boot handler skipped: " + e.message + ")"); } });

const FF = window.FF, W = FF.W, M = window.FF.M;
const creditsEl = fakeEl('[data-credits]');
const usdtEl = fakeEl('[data-usdt]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setUser(user) { FF.store.set("ff_users", [user]); }
function getUser() { return FF.DB.users()[0]; }
function setAuth(email) {
  FF.store.set("ff_session", email);
  FF.store.set("ff_auth", { accessToken: "tok", refreshToken: null, userId: "u1", email, expiresAt: Date.now() + 3600e3 });
}
function walletStatePayload(points, available, locked) {
  return {
    server: true, now: Date.now(),
    config: { minDeposit: 10, minWithdraw: 10, withdrawFeePct: 1, platformFeePct: 5, minPointsConvert: 1000, minJobReward: 0.02, pointsPerUsdt: 1000 },
    networks: [], categories: [],
    wallet: { available, locked: locked || 0, points, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0 },
    txns: [], requests: [],
  };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : "")); }
}

async function main() {
  /* ============ SCENARIO 1: the reported bug ============ */
  console.log("\n[1] server wallet_state must not zero out browser-earned points/USDT");
  setUser({ name: "Rohan", email: "rohan@test.dev", memberId: "FF-X1", credits: 59, earned: 59, spent: 0, activity: [], campaigns: [], refCode: "FF-ROH-1234", joined: Date.now(), weekly: [] });
  FF.store.set("ff_wallets", { "rohan@test.dev": { available: 12.34, locked: 0, totalEarned: 12.34, totalDeposited: 0, totalWithdrawn: 0, txns: [] } });
  setAuth("rohan@test.dev");
  rpcResponses = { wallet_state: walletStatePayload(0, 0, 0) };

  let view = await FF.W.api.wallet();
  check("points stay at 59 (server said 0)", creditsEl.textContent === "59", creditsEl.textContent);
  check("usdt stays at 12.34 (server said 0)", usdtEl.textContent === "12.34", usdtEl.textContent);
  check("view.wallet.points merged = 59", view.wallet.points === 59, view.wallet.points);
  check("view.wallet.available merged = 12.34", Math.abs(view.wallet.available - 12.34) < 1e-9, view.wallet.available);
  check("local user credits synced to 59", getUser().credits === 59, getUser().credits);
  check("local wallet synced to 12.34", W.wallet("rohan@test.dev").available === 12.34);

  /* ============ SCENARIO 2: repeated loads stable ============ */
  console.log("\n[2] a second wallet_state (page navigation) keeps values stable");
  await FF.W.api.wallet();
  check("points still 59 after re-sync", creditsEl.textContent === "59", creditsEl.textContent);
  check("usdt still 12.34 after re-sync", usdtEl.textContent === "12.34", usdtEl.textContent);

  /* ============ SCENARIO 3: server credit is adopted, then a server-side spend is reflected ============ */
  console.log("\n[3] server credit adopted; a later server-side spend lowers the merged display");
  // server credits +34 (admin adjust / mining claim on another device)
  rpcResponses = { wallet_state: walletStatePayload(34, 0.025, 0) };
  await FF.W.api.wallet();
  check("points 59 browser + 34 server = 93", creditsEl.textContent === "93", creditsEl.textContent);
  check("local credits adopted to 93", getUser().credits === 93, getUser().credits);
  // now the member converts 25 points ON THE SERVER: srv 34 -> 9
  rpcResponses = { wallet_state: walletStatePayload(9, 0.05, 0) };
  await FF.W.api.wallet();
  check("points now 68 after server-side convert of 25", creditsEl.textContent === "68", creditsEl.textContent);
  check("local credits updated to 68", getUser().credits === 68, getUser().credits);

  /* ============ SCENARIO 4: optional import SQL ============ */
  console.log("\n[4] wallet_import_points hands browser points to the server (no double count)");
  // state: srv 9, mark 9, loc 68. Earn 100 more locally -> loc 168, excess 100.
  FF.store.set("ff_pts_import", {});   // previous auto-attempts backed off (SQL was absent) — allow a retry
  rpcCalls = [];                       // count from here
  FF.awardCredits("rohan@test.dev", 100, "Daily check-in bonus");
  check("local earn raises pill to 168", creditsEl.textContent === "168", creditsEl.textContent);
  // import adds the 100+59 un-imported excess (159): server 9 -> 168; wallet_state returns 168
  rpcResponses = { wallet_import_points: walletStatePayload(168, 0.05, 0) };
  FF.W.maybeImportPoints();          // fire-and-forget
  await sleep(40);
  check("import RPC was called", rpcCalls.filter((c) => c === "wallet_import_points").length >= 1, rpcCalls);
  check("points still 168 after import (no double count)", creditsEl.textContent === "168", creditsEl.textContent);
  rpcResponses = { wallet_state: walletStatePayload(168, 0.05, 0) };
  await FF.W.api.wallet();
  check("points remain 168 on next sync", creditsEl.textContent === "168", creditsEl.textContent);

  /* ============ SCENARIO 5: import SQL missing ============ */
  console.log("\n[5] import SQL not installed -> error swallowed, display keeps working");
  FF.store.set("ff_pts_import", {});   // allow retry
  FF.awardCredits("rohan@test.dev", 50, "Website visit");   // loc 218
  rpcResponses = { wallet_state: walletStatePayload(168, 0.05, 0), wallet_import_points: { __error: "Could not find the function public.wallet_import_points", status: 404 } };
  FF.W.maybeImportPoints();
  await sleep(40);
  check("import backed off for today", (FF.store.get("ff_pts_import", {})["rohan@test.dev"] || {}).day === new Date().toISOString().slice(0, 10));
  check("points still show 218 (168+50)", creditsEl.textContent === "218", creditsEl.textContent);
  rpcResponses = { wallet_state: walletStatePayload(168, 0.05, 0) };
  await FF.W.api.wallet();
  check("reconcile keeps 218 after sync", creditsEl.textContent === "218", creditsEl.textContent);

  /* ============ SCENARIO 6: fresh-browser login ============ */
  console.log("\n[6] fresh-browser login adopts the server balance (no phantom +25)");
  FF.store.set("ff_srv_sync", {});
  FF.store.set("ff_wallets", {});
  setUser({ name: "Priya", email: "priya@test.dev", memberId: "FF-X2", credits: 0, earned: 0, spent: 0, activity: [], campaigns: [], refCode: "FF-PRI-5678", joined: Date.now(), weekly: [] });
  setAuth("priya@test.dev");
  rpcResponses = { wallet_state: walletStatePayload(1234, 5, 0) };
  await FF.W.api.wallet();
  check("server balance adopted: points 1,234", creditsEl.textContent === "1,234", creditsEl.textContent);
  check("server usdt adopted: 5.00", usdtEl.textContent === "5.00", usdtEl.textContent);
  check("earned counter bumped by server accrual", getUser().earned === 1234, getUser().earned);

  /* ============ SCENARIO 7: mining snapshot merges ============ */
  console.log("\n[7] mining_state payload merges balances too (mining.html pill fix)");
  setUser({ name: "Rohan", email: "rohan@test.dev", memberId: "FF-X1", credits: 59, earned: 59, spent: 0, activity: [], campaigns: [], refCode: "FF-ROH-1234", joined: Date.now(), weekly: [] });
  setAuth("rohan@test.dev");
  FF.store.set("ff_srv_sync", {});
  rpcResponses = {
    mining_state: {
      server: true, now: Date.now(),
      config: { min_claim_usdt: 0.05, points_bonus_pct: 10, boost_pct: 25, boost_hours: 8, maintenance_pct: 8, points_per_usdt: 1000, custom_min_ghs: 100, custom_max_ghs: 20000 },
      plans: [], balances: { usdt: 0, points: 0 },
      account: { ghs: 30, perDay: 0.02, unclaimed: 0.01, claimed: 0, boosted: false, boostUntil: 0, lastBoost: 0 },
      contracts: [], log: [],
    },
  };
  const view7 = await FF.M.api.load();
  check("mining view balances merged: points 59", view7.balances.points === 59, view7.balances.points);
  check("mining local credits stay 59", getUser().credits === 59, getUser().credits);

  /* ============ SCENARIO 8: local mode untouched ============ */
  console.log("\n[8] local (browser-only) mode keeps working exactly like before");
  FF.store.set("ff_auth", null);
  FF.store.set("ff_session", "demo@flexfam.io");
  setUser({ name: "Demo Star", email: "demo@flexfam.io", memberId: "FF-DEMO", credits: 1240, earned: 3870, spent: 2630, activity: [], campaigns: [], refCode: "FF-DEMO", joined: Date.now(), weekly: [] });
  const view8 = await FF.W.api.wallet();
  FF.syncCreditPills(); W.syncWalletPills();   // emulate a fresh page load painting
  check("local mode: view points 1240", view8.wallet.points === 1240, view8.wallet.points);
  check("local mode: mode is 'local'", view8.mode === "local", view8.mode);
  check("pills paint 1,240", creditsEl.textContent === "1,240", creditsEl.textContent);

  /* ============ SCENARIO 9: welcome bonus on signup only ============ */
  console.log("\n[9] signup keeps the welcome bonus, login does not");
  FF.store.set("ff_users", []);
  FF.store.set("ff_srv_sync", {});
  // login (existing server account) -> local record created WITHOUT the +25 bonus
  rpcResponses = { token: { user: { id: "u9", email: "newbie@test.dev", user_metadata: { display_name: "Newbie" } }, access_token: "t", refresh_token: "r", expires_in: 3600 } };
  await FF.loginMember("newbie@test.dev", "password123");
  let newbie = FF.DB.users().find((u) => u.email === "newbie@test.dev");
  check("login-created member exists", !!newbie, newbie);
  check("login-created member has 0 credits (no phantom bonus)", newbie && newbie.credits === 0, newbie && newbie.credits);
  // signup (brand new account) -> welcome bonus applies
  FF.store.set("ff_users", []);
  rpcResponses = { signup: { user: { id: "u10", email: "signup@test.dev" }, session: null } };
  await FF.signupMember("Fresh Signup", "signup@test.dev", "password123");
  const fresh = FF.DB.users().find((u) => u.email === "signup@test.dev");
  check("signup-created member exists", !!fresh, fresh);
  check("signup-created member has the +25 welcome bonus", fresh && fresh.credits === 25, fresh && fresh.credits);

  /* ============ SCENARIO 10: expanded mining economy ============ */
  console.log("\n[10] mining catalog has higher rate and $5+/day plans");
  FF.store.set("ff_session", "signup@test.dev");
  const economy = FF.M.api.view();
  const emerald = FF.M.plan("emerald");
  const diamond = FF.M.plan("diamond");
  const quantum = FF.M.plan("quantum");
  check("gross rate raised to 0.00105", FF.M.CFG.usdPerGhsDay === 0.00105, FF.M.CFG.usdPerGhsDay);
  check("catalog expanded to 8 plans", FF.M.PLANS.length === 8, FF.M.PLANS.length);
  check("new $10 Emerald step exists", emerald && emerald.priceUsd === 10, emerald);
  check("Diamond estimate is above $5/day", diamond && FF.M.api.dailyUsd(economy, diamond.ghs, diamond.priceUsd) > 5, diamond);
  check("Quantum estimate is above $10/day", quantum && FF.M.api.dailyUsd(economy, quantum.ghs, quantum.priceUsd) > 10, quantum);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch((err) => { console.error("HARNESS ERROR", err); process.exit(2); });
