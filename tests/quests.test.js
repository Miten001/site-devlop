/* =========================================================================
   FLEXFAM — Daily Quests & Profile Badges Test Suite
   -------------------------------------------------------------------------
   Verifies:
     1. Quests & Badges engine + quests.html in browser/local mode
        (progress tracking, points + USDT claims, double-claim guard,
        UTC daily reset vs permanent milestones, filters, badge pinning).
     2. Server mode (quests_state, quests_claim, wallet_state sync, and
        graceful PGRST202 fallback when SQL #27 is not yet installed).
     3. Dashboard Quests & Badges widget + greeting badge flair + claim.
     4. Navigation wiring across all app pages & SQL security invariants.
   ========================================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) {
    console.log("  PASS", label);
    pass++;
  } else {
    console.error("  FAIL", label, detail !== undefined ? "->" : "", detail !== undefined ? detail : "");
    fail++;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage(file, { storage = {}, user = null, rpcHandler = null, serverMode = false } = {}) {
  let html = fs.readFileSync(path.join(ROOT, file), "utf8");
  html = html
    .replace(/<link[^>]+fonts\.googleapis[^>]*>/gi, "")
    .replace(/<script[^>]+src="https?:\/\/[^"]+"[^>]*><\/script>/gi, "")
    .replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/gi, (_, src) => {
      const rel = src.split("?")[0];
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      return "<script>\n" + code.replace(/<\/script>/gi, "<\\/script>") + "\n</script>";
    });

  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => {
    if (!/Not implemented|Could not load/.test(String(err.message || err))) {
      console.error("[jsdomError]", file, err.message);
    }
  });

  const dom = new JSDOM(html, {
    url: "https://flexfam.test/" + file,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.scrollTo = () => {};
      win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      win.cancelAnimationFrame = (id) => clearTimeout(id);
      win.alert = () => {};
      win.confirm = () => true;
      win.open = () => null;
      win.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

      win.localStorage.setItem("ff_demo_campaigns_purged", "1");
      win.localStorage.setItem("ff_demo_purged", "1");
      Object.keys(storage).forEach((k) => {
        win.localStorage.setItem(k, storage[k]);
      });

      if (serverMode) {
        win.localStorage.setItem("ff_auth", JSON.stringify({
          accessToken: "test-token",
          refreshToken: "test-refresh",
          expiresAt: Date.now() + 3600 * 1000,
          userId: "u-quest",
          email: user ? user.email : "alice@test.dev",
        }));
      }
      if (user) {
        win.localStorage.setItem("ff_session", JSON.stringify(user.email));
        const users = JSON.parse(win.localStorage.getItem("ff_users") || "[]");
        if (!users.some((u) => u.email === user.email)) {
          users.push(Object.assign({
            name: user.name || "Member",
            email: user.email,
            credits: 50,
            earned: 0,
            spent: 0,
            campaigns: [],
            activity: [],
          }, user));
          win.localStorage.setItem("ff_users", JSON.stringify(users));
        }
      }

      win.fetch = (url, opts) => {
        if (!serverMode) return Promise.reject(new Error("offline"));
        const u = String(url);
        const m = u.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
        if (m && rpcHandler) {
          const body = opts && opts.body ? JSON.parse(opts.body) : {};
          return Promise.resolve().then(() => rpcHandler(m[1], body)).then((res) => {
            if (res && res.__httpError) {
              return {
                ok: false,
                status: res.status || 404,
                text: () => Promise.resolve(JSON.stringify({ code: res.code, message: res.message })),
                json: () => Promise.resolve({ code: res.code, message: res.message }),
              };
            }
            return {
              ok: true,
              status: 200,
              text: () => Promise.resolve(JSON.stringify(res)),
              json: () => Promise.resolve(res),
            };
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve("[]"),
          json: () => Promise.resolve([]),
        });
      };
    },
  });

  function snapshotStorage() {
    const out = {};
    for (let i = 0; i < dom.window.localStorage.length; i++) {
      const k = dom.window.localStorage.key(i);
      out[k] = dom.window.localStorage.getItem(k);
    }
    return out;
  }

  return { dom, win: dom.window, doc: dom.window.document, snapshotStorage };
}

(async () => {
  /* =====================================================================
     1. LOCAL / BROWSER MODE — quests.html FULL FLOW
     ===================================================================== */
  console.log("\n[1] Daily Quests & Badges (quests.html — local mode)");

  // Fresh account: 0 ready, 0/8 badges, Newcomer
  let p = openPage("quests.html", { user: { name: "Newbie", email: "newbie@test.dev", credits: 25 } });
  await sleep(40);
  check("Fresh member starts with 0 ready to claim", p.doc.getElementById("qs-ready").textContent === "0");
  check("Fresh member starts with 0 / 6 daily quests done", p.doc.getElementById("qs-daily").textContent === "0 / 6");
  check("Fresh member starts with 0 / 8 badges unlocked", p.doc.getElementById("qs-badges").textContent === "0 / 8");
  check("Fresh member starts at rank 'Newcomer'", p.doc.getElementById("qs-rank").textContent === "Newcomer");
  check("All 14 quests render on quests.html", p.doc.querySelectorAll(".quest-card").length === 14);
  check("All 8 badges render in #badge-grid", p.doc.querySelectorAll(".badge-card").length === 8);

  let incompleteErr = "";
  try { await p.win.FF.Q.api.claim("daily_campaigns_3"); } catch (e) { incompleteErr = e.message; }
  check("Claiming an incomplete quest is rejected", /finish the goal/i.test(incompleteErr), incompleteErr);
  p.win.close();

  // Active member with real progress across campaigns, micro-jobs, streak, created campaign
  const now = Date.now();
  const todayIso = new Date(now).toISOString().slice(0, 10);
  const activeStorage = {
    ff_camp_subs: JSON.stringify([
      { id: "cs1", campaignId: "c1", worker: "alice@test.dev", status: "approved", at: now - 1000 },
      { id: "cs2", campaignId: "c2", worker: "alice@test.dev", status: "approved", at: now - 2000 },
      { id: "cs3", campaignId: "c3", worker: "alice@test.dev", status: "approved", at: now - 3000 },
      { id: "cs4", campaignId: "c4", worker: "alice@test.dev", status: "approved", at: now - 90 * 3600 * 1000 },
    ]),
    ff_job_subs: JSON.stringify([
      { id: "js1", jobId: "j1", worker: "alice@test.dev", status: "approved", at: now - 500 },
    ]),
    ff_streak: JSON.stringify({
      "alice@test.dev": { streak: 7, best: 7, lastDate: todayIso, lastClaimAt: now - 500 },
    }),
    ff_campaigns: JSON.stringify([
      { id: "own1", authorEmail: "alice@test.dev", title: "My YT", platform: "youtube", active: true },
    ]),
  };

  p = openPage("quests.html", {
    storage: activeStorage,
    user: { name: "Alice", email: "alice@test.dev", credits: 100 },
  });
  await sleep(50);

  // Ready: daily_checkin, daily_campaigns_3, daily_jobs_1, mile_tasks_5 (4 camp + 1 job), mile_streak_7, mile_creator_1 = 6
  check("Active member has 6 quests ready to claim", p.doc.getElementById("qs-ready").textContent === "6", p.doc.getElementById("qs-ready").textContent);
  check("Active member unlocks 3 badges (Starter Spark, Week Warrior, Creator Launch)", p.doc.getElementById("qs-badges").textContent === "3 / 8", p.doc.getElementById("qs-badges").textContent);
  check("Active member reaches rank 'Task Specialist'", p.doc.getElementById("qs-rank").textContent === "Task Specialist", p.doc.getElementById("qs-rank").textContent);

  // Filter chips work
  p.doc.querySelector('[data-qfilter="claimable"]').click();
  check("'Ready to claim' filter shows exactly 6 claimable quests", p.doc.querySelectorAll(".quest-card").length === 6);
  p.doc.querySelector('[data-qfilter="daily"]').click();
  check("'Daily quests' filter shows exactly 6 daily quests", p.doc.querySelectorAll(".quest-card").length === 6);
  p.doc.querySelector('[data-qfilter="milestone"]').click();
  check("'Milestones' filter shows exactly 8 milestone quests", p.doc.querySelectorAll(".quest-card").length === 8);
  p.doc.querySelector('[data-qfilter="all"]').click();

  // Claim a POINTS quest (daily_campaigns_3 -> +25 points)
  const ptsBefore = p.win.FF.currentUser().credits;
  p.doc.querySelector('[data-claim-quest="daily_campaigns_3"]').click();
  await sleep(40);
  check("Claiming points quest credits +25 points immediately", p.win.FF.currentUser().credits === ptsBefore + 25, p.win.FF.currentUser().credits);
  check("Ready count drops to 5 after claiming one quest", p.doc.getElementById("qs-ready").textContent === "5");
  check("Daily quests counter updates to 1 / 6", p.doc.getElementById("qs-daily").textContent === "1 / 6");

  // Claim a USDT quest (daily_jobs_1 -> +$0.01 USDT)
  const usdtBefore = p.win.FF.W.wallet("alice@test.dev").available;
  p.doc.querySelector('[data-claim-quest="daily_jobs_1"]').click();
  await sleep(40);
  const usdtAfter = p.win.FF.W.wallet("alice@test.dev").available;
  check("Claiming USDT quest credits +$0.01 USDT immediately", Math.round((usdtAfter - usdtBefore) * 100) === 1, { usdtBefore, usdtAfter });
  const txns = p.win.FF.W.localView("alice@test.dev").txns;
  check("USDT quest claim logs a 'quest' entry in wallet history", txns.some((t) => t.type === "quest" && Math.round(t.amount * 100) === 1));

  // Double-claim is blocked
  let dupErr = "";
  try { await p.win.FF.Q.api.claim("daily_campaigns_3"); } catch (e) { dupErr = e.message; }
  check("Duplicate claim on same day is rejected", /already claimed/i.test(dupErr), dupErr);

  // Claim a lifetime milestone (mile_streak_7) and test next-day UTC reset behavior
  p.doc.querySelector('[data-claim-quest="mile_streak_7"]').click();
  await sleep(40);
  const tomorrowMs = now + 24 * 3600 * 1000;
  const tomorrowView = p.win.FF.Q.localView("alice@test.dev", tomorrowMs);
  const tomorrowDaily = tomorrowView.quests.find((q) => q.id === "daily_campaigns_3");
  const tomorrowMile = tomorrowView.quests.find((q) => q.id === "mile_streak_7");
  check("Daily quest resets to unclaimed on next UTC day", tomorrowDaily && !tomorrowDaily.claimed);
  check("Lifetime milestone stays permanently claimed on next UTC day", tomorrowMile && tomorrowMile.claimed);

  // Pin an unlocked badge
  p.doc.querySelector('[data-pin-badge="badge_streak7"]').click();
  check("Pinning an unlocked badge updates button to 'Pinned ★'",
    p.doc.querySelector('[data-pin-badge="badge_streak7"]').textContent.includes("Pinned"));
  check("Pinned badge is stored in localStorage", p.win.FF.Q.pinnedBadgeId("alice@test.dev") === "badge_streak7");

  const snapForDash = p.snapshotStorage();
  p.win.close();

  /* =====================================================================
     2. DASHBOARD WIDGET + GREETING BADGE FLAIR (dashboard.html)
     ===================================================================== */
  console.log("\n[2] Dashboard Quests & Badges widget + profile flair");

  const dp = openPage("dashboard.html", {
    storage: snapForDash,
    user: { name: "Alice", email: "alice@test.dev" },
  });
  await sleep(60);
  const dashPanel = dp.doc.getElementById("quests-panel");
  const helloBadge = dp.doc.getElementById("hello-badge");
  check("Dashboard greeting renders pinned badge flair ('Week Warrior')",
    helloBadge && !helloBadge.classList.contains("hidden") && helloBadge.textContent.includes("Week Warrior"),
    helloBadge && helloBadge.textContent);
  check("Dashboard Quests widget shows remaining ready-to-claim count (3 ready to claim)",
    dashPanel && /3 ready to claim/i.test(dashPanel.textContent),
    dashPanel && dashPanel.textContent.slice(0, 120));
  const dashClaimBtn = dashPanel.querySelector("[data-dash-claim]");
  check("Dashboard Quests widget provides direct Claim button", !!dashClaimBtn);
  dashClaimBtn.click();
  await sleep(40);
  check("Claiming directly from Dashboard widget decrements ready count to 2",
    /2 ready to claim/i.test(dashPanel.textContent),
    dashPanel.textContent.slice(0, 120));
  dp.win.close();

  /* =====================================================================
     3. SERVER MODE (quests_state + quests_claim + wallet_state sync)
     ===================================================================== */
  console.log("\n[3] Server mode RPCs & graceful SQL-not-installed fallback");

  let srvClaimed = false;
  let walletSyncCount = 0;
  const makeSrvState = () => ({
    todayKey: todayIso,
    utcResetAt: now + 3600 * 1000,
    metrics: { todayCheckin: 1, todayCampaigns: 3, todayJobs: 1, todayMining: 0, totalTasks: 25, bestStreak: 7, referrals: 3, createdCount: 1 },
    quests: [
      { id: "daily_jobs_1", kind: "daily", title: "Micro-Job Starter", metric: "todayJobs", progress: 1, rawProgress: 1, target: 1, rewardType: "usdt", rewardAmount: 0.01, badgeId: null, periodKey: todayIso, claimed: srvClaimed, claimable: !srvClaimed },
      { id: "mile_tasks_25", kind: "milestone", title: "Task Hunter", metric: "totalTasks", progress: 25, rawProgress: 25, target: 25, rewardType: "usdt", rewardAmount: 0.05, badgeId: "badge_hunter", periodKey: "lifetime", claimed: false, claimable: true },
    ],
    badges: [
      { id: "badge_hunter", questId: "mile_tasks_25", unlocked: true, claimed: false, progress: 25, target: 25 },
    ],
    totals: { claims: srvClaimed ? 1 : 0, usdt: srvClaimed ? 0.01 : 0, points: 0 },
  });

  const sp = openPage("quests.html", {
    serverMode: true,
    user: { name: "Alice", email: "alice@test.dev" },
    rpcHandler(fn, body) {
      if (fn === "quests_state") return makeSrvState();
      if (fn === "quests_claim") {
        srvClaimed = true;
        return {
          claimed: { id: body.p_quest_id, title: "Micro-Job Starter", rewardType: "usdt", rewardAmount: 0.01, badgeId: null },
          state: makeSrvState(),
        };
      }
      if (fn === "wallet_state") {
        walletSyncCount++;
        return { wallet: { available: 10.01, locked: 0, points: 100, totalEarned: 10.01, totalDeposited: 0, totalWithdrawn: 0 }, config: {}, networks: [], categories: [], txns: [], requests: [] };
      }
      return {};
    },
  });
  await sleep(60);
  check("Server mode displays 'Server-synced' pill", sp.doc.getElementById("q-mode-pill").textContent === "Server-synced");
  const srvWalletBefore = walletSyncCount;
  sp.doc.querySelector('[data-claim-quest="daily_jobs_1"]').click();
  await sleep(60);
  check("Server mode claim calls quests_claim and marks quest claimed", srvClaimed && !sp.doc.querySelector('[data-claim-quest="daily_jobs_1"]'));
  check("Server mode claim refreshes wallet_state immediately", walletSyncCount > srvWalletBefore);
  sp.win.close();

  // Graceful fallback when SQL #27 has not been run yet (PGRST202)
  const mp = openPage("quests.html", {
    serverMode: true,
    user: { name: "Alice", email: "alice@test.dev" },
    rpcHandler(fn) {
      if (fn === "quests_state" || fn === "quests_claim") {
        return { __httpError: true, status: 404, code: "PGRST202", message: "Could not find the function public.quests_state in the schema cache" };
      }
      if (fn === "wallet_state") {
        return { wallet: { available: 5, locked: 0, points: 50, totalEarned: 5, totalDeposited: 0, totalWithdrawn: 0 }, config: {}, networks: [], categories: [], txns: [], requests: [] };
      }
      return {};
    },
  });
  await sleep(60);
  check("Missing SQL #27 degrades gracefully with 'Sync pending' pill and notice banner",
    mp.doc.getElementById("q-mode-pill").textContent === "Sync pending" && !mp.doc.getElementById("q-notice").classList.contains("hidden"));
  let migErr = null;
  try { await mp.win.FF.Q.api.claim("daily_checkin"); } catch (e) { migErr = e; }
  check("Claim before SQL #27 returns friendly setup error without faking local credit",
    migErr && migErr.code === "QUESTS_MIGRATION_REQUIRED");
  mp.win.close();

  /* =====================================================================
     4. NAVIGATION WIRING & SQL SECURITY INVARIANTS
     ===================================================================== */
  console.log("\n[4] Navigation wiring & SQL migration (#27) checks");

  const appPages = ["dashboard.html", "earn.html", "tasks.html", "add.html", "post-task.html", "my-tasks.html", "mining.html", "wallet.html", "refer.html", "quests.html"];
  appPages.forEach((pg) => {
    const raw = fs.readFileSync(path.join(ROOT, pg), "utf8");
    check(pg + " links to quests.html", /href="quests\.html"/.test(raw));
  });

  const questsHtml = fs.readFileSync(path.join(ROOT, "quests.html"), "utf8");
  const dashHtml = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
  const qVer = (questsHtml.match(/wallet\.js\?v=([0-9.]+)/) || [])[1];
  const dVer = (dashHtml.match(/wallet\.js\?v=([0-9.]+)/) || [])[1];
  check("quests.html loads the same wallet.js version as dashboard.html", !!qVer && qVer === dVer, { qVer, dVer });

  const sql27 = fs.readFileSync(path.join(ROOT, "supabase-quests-badges.sql"), "utf8");
  check("SQL #27 defines unique (user_id, quest_id, period_key) on quest_claims", /unique\s*\(\s*user_id,\s*quest_id,\s*period_key\s*\)/i.test(sql27));
  check("SQL #27 enables RLS on quest_claims", /alter table public\.quest_claims enable row level security/i.test(sql27));
  check("SQL #27 locks public.balances for update before checking/claiming", /from public\.balances where user_id = v_user for update/i.test(sql27));
  check("SQL #27 verifies progress >= target on the server", /v_progress < v_q\.target/i.test(sql27));
  check("SQL #27 revokes public/anon and grants authenticated on quests_state & quests_claim",
    /revoke all on function public\.quests_state\(\)\s+from public, anon/i.test(sql27) &&
    /grant execute on function public\.quests_claim\(text\)\s+to authenticated/i.test(sql27));
  check("SQL #27 sets Fam Ambassador target to 1000 referrals", /'mile_refer_10',\s*'milestone',\s*'Fam Ambassador',\s*'referrals',\s*1000/.test(sql27));
  check("SQL #27 reloads PostgREST schema cache", /notify pgrst, 'reload schema'/i.test(sql27));

  const runOrder = fs.readFileSync(path.join(ROOT, "RUN-ORDER.md"), "utf8");
  check("RUN-ORDER.md lists #27 supabase-quests-badges.sql", /\| 27 \| \[`supabase-quests-badges\.sql`\]/.test(runOrder));

  console.log("\n===============================================================");
  console.log(" QUESTS & BADGES TESTS: " + pass + " PASSED, " + fail + " FAILED");
  console.log("===============================================================");
  process.exit(fail > 0 ? 1 : 0);
})();
