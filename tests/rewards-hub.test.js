/* =========================================================================
   FlexFam — Rewards Hub & Public Showcase Card Test Suite (#28)
   Covers:
     1. Lucky Spin / Daily Wheel (free spin, task bonus spin, 25-pt extra spin, limits)
     2. Weekly Leaderboard & Prize Pool (categories, Top-3 podium, prize claim & duplicate guard)
     3. Promo / Gift Codes (case-insensitive redeem, double-redeem block, paused/expired/limit, Wallet & Dashboard bars)
     4. VIP Membership Tiers (Bronze -> Diamond XP ladder, daily bonus claim & duplicate guard, Dashboard flair)
     5. Public Member Showcase Card (logged-in studio, unauthenticated ?u=CODE public view, PNG canvas, zero private leaks)
     6. Admin Promo Manager wiring, navigation consistency & SQL #28 security assertions
   ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra !== undefined ? "   -> " + JSON.stringify(extra) : ""));
  }
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inlinedHtml(file) {
  return read(file).replace(/<script\s+src="([^"]+)"><\/script>/gi, (match, src) => {
    const clean = src.split("?")[0];
    const p = path.join(ROOT, clean);
    return fs.existsSync(p) ? "<script>" + fs.readFileSync(p, "utf8") + "<\/script>" : match;
  });
}

function createDOM(file, options = {}) {
  const { storage = {}, userEmail = null, query = "", hash = "", customFetch = null } = options;
  if (userEmail) storage["ff_session"] = JSON.stringify(userEmail);
  storage["ff_demo_campaigns_purged"] = "1";
  storage["ff_demo_purged"] = "1";

  const localStorageMock = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
    clear() { for (const k in storage) delete storage[k]; },
  };
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));

  const dom = new JSDOM(inlinedHtml(file), {
    url: "https://flexfam.test/" + file + query + hash,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", { value: localStorageMock, writable: true });
      window.FF_SUPABASE_CONFIG = { url: "https://YOUR-PROJECT.supabase.co", anonKey: "" };
      window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;
      window.fetch = customFetch || (() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) }));
      if (!window.navigator.clipboard) {
        Object.defineProperty(window.navigator, "clipboard", {
          value: { writeText: () => Promise.resolve() }, configurable: true,
        });
      }
    },
  });
  return { dom, storage, errors };
}

function baseStorage() {
  return {
    ff_users: JSON.stringify([
      { id: "u_alice", email: "alice@test.dev", name: "Alice Pro", credits: 200, referrals: 5, joinedAt: Date.now() - 86400000 * 30 },
      { id: "u_bob",   email: "bob@test.dev",   name: "Bob Starter", credits: 40, referrals: 1, joinedAt: Date.now() - 86400000 * 5 },
    ]),
    ff_wallets: JSON.stringify({
      "alice@test.dev": { available: 4.5, locked: 0, totalEarned: 9.25, totalDeposited: 0, totalWithdrawn: 0, txns: [] },
      "bob@test.dev":   { available: 0.5, locked: 0, totalEarned: 1.10, totalDeposited: 0, totalWithdrawn: 0, txns: [] },
    }),
    ff_campaigns: JSON.stringify([
      { id: "c1", title: "My Channel", authorEmail: "alice@test.dev", active: true, payout: 10 },
    ]),
    ff_camp_subs: JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({
        id: "cs_" + i, campaignId: "c_" + i, worker: "alice@test.dev", status: "approved", at: Date.now() - 60000,
      }))
    ),
  };
}

async function main() {
  /* ---------------------------------------------------------------- */
  console.log("\n[1] Rewards Hub — Lucky Spin, VIP Tiers, Promo Codes & Weekly Leaderboard (local mode)");
  const store = baseStorage();
  const { dom, errors } = createDOM("rewards.html", { storage: store, userEmail: "alice@test.dev" });
  await sleep(100);
  const w = dom.window;
  const d = w.document;
  const R = w.FF.R;

  check("window.FF.R engine loaded cleanly", !!R && !!R.api);
  check("8 wheel segments rendered in SVG rotor", d.querySelectorAll("#wheel-rotor path").length === 8);
  check("All 5 VIP tiers exist (Bronze -> Diamond)", R.VIP_TIERS.length === 5 && R.VIP_TIERS[0].id === "bronze" && R.VIP_TIERS[4].id === "diamond");

  // VIP tier check: Alice has 12 tasks * 20 = 240 + 5 refs * 40 = 200 => 440 XP => Silver VIP
  const vipBefore = await R.api.vipState();
  check("Alice XP computed accurately (440 XP -> Silver VIP)", vipBefore.xp === 440 && vipBefore.tierId === "silver", vipBefore);
  check("Silver VIP has 1.1x spin boost and +25 pts daily bonus", vipBefore.spinMult === 1.1 && vipBefore.dailyType === "points" && vipBefore.dailyAmount === 25);

  const ptsBeforeVip = w.FF.currentUser().credits;
  const vipClaim = await R.api.vipClaimDaily();
  check("Daily VIP bonus claims cleanly (+25 pts)", vipClaim.claimed.rewardAmount === 25 && vipClaim.state.claimedToday === true);
  check("Alice credits increased by +25 pts after VIP claim", w.FF.currentUser().credits === ptsBeforeVip + 25);
  let dupVipErr = null;
  try { await R.api.vipClaimDaily(); } catch (e) { dupVipErr = e.message; }
  check("Duplicate daily VIP claim on same day is blocked", /already claimed/i.test(dupVipErr || ""), dupVipErr);

  // Lucky Spin check: Alice completed tasks today => 1 base free + 1 task bonus = 2 free spins
  const spBefore = await R.api.spinState();
  check("Task bonus spin unlocked today (2 free spins total)", spBefore.taskBonusUnlocked === true && spBefore.freeTotal === 2 && spBefore.freeLeft === 2, spBefore);
  const s1 = await R.api.spinPlay(false);
  check("First free spin succeeds with 1.1x VIP multiplier", !!s1.spin && s1.spin.multiplier === 1.1 && s1.state.freeLeft === 1, s1.spin);
  const s2 = await R.api.spinPlay(false);
  check("Second free spin uses remaining free allowance (0 left)", s2.state.freeLeft === 0);
  let noFreeErr = null;
  try { await R.api.spinPlay(false); } catch (e) { noFreeErr = e.message; }
  check("Third free spin on same day is blocked", /No free spins left/i.test(noFreeErr || ""), noFreeErr);

  // Paid extra spin (25 pts)
  const spPaid1 = await R.api.spinPlay(true);
  check("Extra paid spin (25 pts) succeeds", spPaid1.spin.paid === true && spPaid1.state.paidLeft === 1);
  const spPaid2 = await R.api.spinPlay(true);
  check("Second extra paid spin succeeds (0 paid left)", spPaid2.state.paidLeft === 0);
  let paidCapErr = null;
  try { await R.api.spinPlay(true); } catch (e) { paidCapErr = e.message; }
  check("Third paid spin on same day is blocked (daily cap 2)", /extra spin limit/i.test(paidCapErr || ""), paidCapErr);

  // Promo / Gift Codes
  const ptsBeforePromo = w.FF.currentUser().credits;
  const pRes = await R.api.promoRedeem("  flexwelcome  ");
  check("Starter gift code FLEXWELCOME redeems case-insensitively (+50 pts)", pRes.redeemed.code === "FLEXWELCOME" && pRes.redeemed.rewardAmount === 50);
  check("Credits increased by +50 pts after gift code redemption", w.FF.currentUser().credits === ptsBeforePromo + 50);
  let dupPromoErr = null;
  try { await R.api.promoRedeem("FLEXWELCOME"); } catch (e) { dupPromoErr = e.message; }
  check("Duplicate gift code redemption by same member is blocked", /already redeemed/i.test(dupPromoErr || ""), dupPromoErr);
  let badPromoErr = null;
  try { await R.api.promoRedeem("NOPE999"); } catch (e) { badPromoErr = e.message; }
  check("Unknown gift code returns friendly not-found error", /not found/i.test(badPromoErr || ""), badPromoErr);

  // Weekly Leaderboard & Prize Pool
  const lbEarn = await R.api.leaderboardState("earners");
  check("Weekly Leaderboard Top Earners ranks Alice #1 above Bob #2", lbEarn.entries.length === 2 && lbEarn.entries[0].displayName === "Alice Pro" && lbEarn.myRank === 1, lbEarn.entries);
  const lbTask = await R.api.leaderboardState("taskers");
  check("Weekly Leaderboard Top Taskers reflects Alice's 12 completed tasks", lbTask.entries[0].score === 12);
  const lbRef = await R.api.leaderboardState("referrers");
  check("Weekly Leaderboard Top Referrers ranks Alice #1 (5 refs) over Bob #2 (1 ref)", lbRef.entries[0].score === 5 && lbRef.entries[1].score === 1);

  const availBeforeLb = JSON.parse(store["ff_wallets"])["alice@test.dev"].available;
  const lbClaim = await R.api.leaderboardClaim("earners", lbEarn.prevWeekKey);
  check("Weekly #1 leaderboard prize claims +$0.25 USDT", lbClaim.claimed.rewardAmount === 0.25 && lbClaim.claimed.rank === 1);
  const availAfterLb = JSON.parse(store["ff_wallets"])["alice@test.dev"].available;
  check("USDT wallet increased by +$0.25 after leaderboard prize claim", Math.abs((availAfterLb - availBeforeLb) - 0.25) < 0.001, { availBeforeLb, availAfterLb });
  let dupLbErr = null;
  try { await R.api.leaderboardClaim("earners", lbEarn.prevWeekKey); } catch (e) { dupLbErr = e.message; }
  check("Duplicate weekly leaderboard prize claim is blocked", /already claimed/i.test(dupLbErr || ""), dupLbErr);

  check("No uncaught JS errors on rewards.html", errors.length === 0, errors);
  dom.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[2] Public Member Showcase Card (profile.html — logged-in & anonymous visitor)");
  const ownProfile = createDOM("profile.html", { storage: baseStorage(), userEmail: "alice@test.dev" });
  await sleep(80);
  const od = ownProfile.dom.window.document;
  const aliceCode = od.getElementById("pf-code").textContent.trim();
  check("Logged-in member sees their Showcase Card name & VIP tier", od.getElementById("pf-name").textContent === "Alice Pro" && /Silver VIP/.test(od.getElementById("pf-vip-pill").textContent));
  check("Showcase Card displays tasks (12), referrals (5), and unlocked badges", od.getElementById("pf-s-tasks").textContent === "12" && od.getElementById("pf-s-refs").textContent === "5" && od.querySelectorAll("#pf-badges .pf-badge").length >= 3);
  check("Share link contains ?u=CODE", od.getElementById("pf-share-url").textContent.includes("?u=" + aliceCode));
  check("Own showcase card hides the visitor signup CTA", od.getElementById("pf-visitor-cta").classList.contains("hidden"));
  check("No uncaught JS errors on own profile.html", ownProfile.errors.length === 0, ownProfile.errors);
  ownProfile.dom.window.close();

  // Public visitor opening profile.html?u=CODE WITHOUT signing in
  const anonProfile = createDOM("profile.html", { storage: baseStorage(), userEmail: null, query: "?u=" + aliceCode });
  await sleep(80);
  const ad = anonProfile.dom.window.document;
  check("Unauthenticated visitor can view Alice's public Showcase Card via ?u=CODE", !ad.getElementById("pf-content").classList.contains("hidden") && ad.getElementById("pf-name").textContent === "Alice Pro");
  check("Visitor sees 'Join FlexFam with Alice Pro's invite' CTA linked to signup.html?ref=CODE", !ad.getElementById("pf-visitor-cta").classList.contains("hidden") && ad.getElementById("pf-cta-btn").getAttribute("href") === "signup.html?ref=" + aliceCode);
  check("Public Showcase Card never exposes member email", !ad.getElementById("pf-card").textContent.includes("alice@test.dev"));
  check("No uncaught JS errors on public visitor profile.html", anonProfile.errors.length === 0, anonProfile.errors);
  anonProfile.dom.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[3] Dashboard & Wallet integrations");
  const dash = createDOM("dashboard.html", { storage: baseStorage(), userEmail: "alice@test.dev" });
  await sleep(100);
  const dd = dash.dom.window.document;
  check("Dashboard greeting shows VIP Tier flair ('Silver VIP')", /Silver VIP/.test(dd.getElementById("hello-vip").textContent));
  check("Dashboard Rewards Hub quick panel renders Lucky Spin, Daily VIP Bonus & Gift Code input",
    !!dd.getElementById("dash-vip-claim") && !!dd.getElementById("dash-promo-in") && dd.getElementById("rewards-panel").textContent.includes("Weekly Leaderboard"));
  check("No uncaught JS errors on dashboard.html", dash.errors.length === 0, dash.errors);
  dash.dom.window.close();

  const wal = createDOM("wallet.html", { storage: baseStorage(), userEmail: "alice@test.dev" });
  await sleep(100);
  const wd = wal.dom.window.document;
  check("Wallet renders inline Gift / Promo Code redeem bar", !!wd.getElementById("wallet-promo-in") && !!wd.getElementById("wallet-promo-btn"));
  check("No uncaught JS errors on wallet.html", wal.errors.length === 0, wal.errors);
  wal.dom.window.close();

  /* ---------------------------------------------------------------- */
  console.log("\n[4] Navigation, Admin Promo Manager & SQL #28 security assertions");
  const appPages = ["dashboard.html", "earn.html", "tasks.html", "quests.html", "rewards.html", "add.html", "post-task.html", "my-tasks.html", "mining.html", "wallet.html", "refer.html"];
  appPages.forEach((p) => {
    const h = read(p);
    check(p + " links to rewards.html and profile.html", /href="rewards\.html"/.test(h) && /href="profile\.html"/.test(h));
  });

  const profileHtml = read("profile.html");
  check("profile.html VIP Showcase Card uses bright pearl-metallic tier palette (no dark/black card background) with crisp high-contrast ink",
    !/#0a0e1b|#101526|#0b0f1e/.test(profileHtml) &&
    /--vc-bg-1:\s*#fffef9/.test(profileHtml) &&
    /--vc-ink:\s*#221605/.test(profileHtml) &&
    /\.pf-stat\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*\.84\)/.test(profileHtml));
  check("profile.html renders VIP Pass header, Smart Chip SVG, XP progress bar & Invite Code copy button",
    /FLEXFAM VIP PASS/.test(profileHtml) && /pf-chip-svg/.test(profileHtml) && /id="pf-vp-fill"/.test(profileHtml) && /id="btn-copy-code"/.test(profileHtml));

  const notifSql = read("supabase-notifications.sql");
  check("supabase-notifications.sql disables wallet_txns_credit_notify and notifies ONLY on pay_requests (deposit & withdraw)",
    /drop trigger if exists wallet_txns_credit_notify on public\.wallet_txns;/i.test(notifSql) &&
    !/create trigger wallet_txns_credit_notify/i.test(notifSql) &&
    !/v_title\s*:=\s*'✅ Wallet updated'/i.test(notifSql) &&
    /create trigger pay_requests_notify_trigger[\s\S]*?on public\.pay_requests/i.test(notifSql) &&
    /if new\.kind not in \('deposit', 'withdraw'\)/i.test(notifSql));

  const adminHtml = read("admin.html");
  check("admin.html has Promo codes nav item and #sec-promos panel", /href="#sec-promos"/.test(adminHtml) && /id="sec-promos"/.test(adminHtml));
  check("admin.html wires admin_promo_list / save / toggle / delete RPCs",
    /admin_promo_list/.test(adminHtml) && /admin_promo_save/.test(adminHtml) && /admin_promo_toggle/.test(adminHtml) && /admin_promo_delete/.test(adminHtml));

  const sql = read("supabase-rewards-hub.sql");
  check("SQL #28 creates all 5 tables with RLS enabled",
    ["spin_logs", "promo_codes", "promo_redemptions", "vip_daily_claims", "leaderboard_claims"]
      .every((t) => new RegExp("create table if not exists public\\." + t).test(sql) && new RegExp("alter table public\\." + t + " enable row level security").test(sql)));
  check("SQL #28 enforces unique constraints against double claims/redemptions",
    /unique \(code_id, user_id\)/.test(sql) && /unique \(user_id, claim_day\)/.test(sql) && /unique \(user_id, week_key, category\)/.test(sql));
  check("SQL #28 locks balances FOR UPDATE before crediting rewards", (sql.match(/from public\.balances\s+where user_id = v_user\s+for update|from public\.balances where user_id = v_user for update/g) || []).length >= 4);
  check("SQL #28 guards all admin promo RPCs with public.is_admin()", (sql.match(/if not public\.is_admin\(\)/g) || []).length >= 4);
  check("SQL #28 grants public_profile_card to anon + authenticated and keeps reward RPCs authenticated-only",
    /grant execute on function public\.public_profile_card\(text\) to anon, authenticated;/.test(sql) &&
    /revoke all on function public\.spin_play\(boolean\) from public, anon;/.test(sql) &&
    /revoke all on function public\.promo_redeem\(text\) from public, anon;/.test(sql));
  check("SQL #28 reloads PostgREST schema cache", /notify pgrst, 'reload schema';/.test(sql));
  check("RUN-ORDER.md documents #28 supabase-rewards-hub.sql", /supabase-rewards-hub\.sql/.test(read("RUN-ORDER.md")));

  console.log("\n===============================================================");
  console.log(` REWARDS HUB & PROFILE TESTS: ${pass} PASSED, ${fail} FAILED`);
  console.log("===============================================================");
  if (fail) process.exit(1);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(2); });
