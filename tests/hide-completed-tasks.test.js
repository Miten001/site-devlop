/* =========================================================================
   FLEXFAM — Hide Completed Tasks + Escrow Breakdown Tests
   -------------------------------------------------------------------------
   Verifies:
     1. Add Page campaigns on earn.html hide immediately from the worker's
        screen after completion / proof submission (local + server mode),
        reappear on rejection for retry, stay visible for other workers and
        for the campaign owner.
     2. Quick Bonus Missions on earn.html hide as each one is completed.
     3. Micro-job tasks on tasks.html hide immediately after submission
        (local + server mode, including defensive filtering of stale/full/
        unfunded rows) while keeping My submissions history intact.
     4. Dashboard & Wallet "In escrow / pending" breakdowns clearly explain
        posted task escrow vs pending withdrawals with direct links, and
        server-mode task mutations refresh wallet_state immediately.
     5. SQL migration (#26) and canonical SQL files exclude completed
        campaigns and escrow-exhausted micro-jobs from open feeds.
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
          userId: "u-test",
          email: user ? user.email : "bob@test.dev",
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
          return Promise.resolve(rpcHandler(m[1], body)).then((res) => ({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify(res)),
            json: () => Promise.resolve(res),
          }));
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
     1. ADD PAGE CAMPAIGNS (earn.html) — LOCAL / BROWSER MODE
     ===================================================================== */
  console.log("\n[1] Add Page campaigns hide on completion (earn.html — local mode)");

  const seedCampaign = {
    id: "camp-yt-1",
    platform: "youtube",
    action: "Subscribe",
    user: "Alice Creator",
    title: "Alice Tech Channel",
    url: "https://youtube.com/@alicetech",
    payout: 20,
    active: true,
    authorEmail: "alice@test.dev",
    created: Date.now() - 10000,
  };
  let shared = {
    ff_campaigns: JSON.stringify([seedCampaign]),
    ff_camp_subs: JSON.stringify([]),
    ff_done: JSON.stringify({}),
  };

  // All platforms/actions use the same proof-free flow, with no premature local credit.
  const timerPage = openPage("earn.html", { storage: Object.assign({}, shared, {
    ff_users: JSON.stringify([{name:"Alice",email:"alice@test.dev",credits:100}])
  }), user: {name:"Bob",email:"bob@test.dev",credits:25} });
  await sleep(30);
  const TF = timerPage.win.FF;
  check("Subscribe and Telegram Join campaigns both use timer mode", TF.isTimerCampaign(seedCampaign) && TF.isTimerCampaign({platform:"telegram",action:"Join",watchSecs:0}));
  let blocked = false;
  try { await TF.completeTimedCampaign(seedCampaign.id); } catch (_) { blocked = true; }
  check("Claim without starting the visit is blocked", blocked);
  await TF.startTimedCampaign(seedCampaign.id);
  const timerNow = timerPage.win.Date.now();
  timerPage.win.Date.now = () => timerNow + 6990;
  blocked = false;
  try { await TF.completeTimedCampaign(seedCampaign.id); } catch (_) { blocked = true; }
  check("No reward before seven full seconds", blocked && TF.currentUser().credits===25);
  timerPage.win.Date.now = () => timerNow + 7001;
  await TF.completeTimedCampaign(seedCampaign.id);
  check("Seven-second visit auto-approves without proof or owner review", TF.DB.campSubs()[0].status==="approved");
  check("Worker earns exactly the reward and owner pays once", TF.currentUser().credits===45 && TF.DB.users().find(u=>u.email==="alice@test.dev").credits===80);
  blocked = false;
  try { await TF.startTimedCampaign(seedCampaign.id); } catch (_) { blocked = true; }
  check("Completed visit cannot be restarted for duplicate rewards", blocked && TF.currentUser().credits===45);
  timerPage.win.close();

  // Owner Alice still sees her own campaign
  let p = openPage("earn.html", { storage: shared, user: { name: "Alice", email: "alice@test.dev", credits: 100 } });
  await sleep(30);
  const aliceBtn = p.doc.querySelector('[data-task="camp-yt-1"]');
  check("Owner Alice still sees her own Add Page campaign", !!aliceBtn && aliceBtn.textContent.includes("Your campaign"));
  shared = p.snapshotStorage();
  p.win.close();

  // Worker Bob sees the campaign, submits proof -> immediately hidden
  p = openPage("earn.html", { storage: shared, user: { name: "Bob", email: "bob@test.dev", credits: 25 } });
  await sleep(30);
  const bobBtn = p.doc.querySelector('[data-task="camp-yt-1"]');
  check("Worker Bob sees open Add Page campaign before completing", !!bobBtn && !bobBtn.disabled);
  bobBtn.click();
  p.win.FF.submitCampaignProof("bob@test.dev", "Bob", "camp-yt-1", "Legacy submission");
  p.win.document.dispatchEvent(new p.win.CustomEvent("ff:campaigns-synced"));
  await sleep(30);
  check("After proof submission, Add Page campaign hides immediately from Bob's screen", !p.doc.querySelector('[data-task="camp-yt-1"]'));
  check("Empty state says 'All tasks complete!' once Bob finishes the only campaign",
    /All tasks complete/i.test(p.doc.getElementById("empty-title").textContent));
  shared = p.snapshotStorage();
  p.win.close();

  // Another worker Carol still sees the campaign
  p = openPage("earn.html", { storage: shared, user: { name: "Carol", email: "carol@test.dev", credits: 25 } });
  await sleep(30);
  check("Another worker Carol still sees the open campaign", !!p.doc.querySelector('[data-task="camp-yt-1"]'));
  p.win.close();

  // Owner rejects Bob's proof -> campaign reappears on Bob's screen with "Try again"
  const subsAfterSubmit = JSON.parse(shared.ff_camp_subs || "[]");
  const bobSubId = subsAfterSubmit[0].id;
  p = openPage("earn.html", { storage: shared, user: { name: "Alice", email: "alice@test.dev", credits: 100 } });
  await sleep(20);
  p.win.FF.reviewCampaignSub(bobSubId, false, "Screenshot missing");
  shared = p.snapshotStorage();
  p.win.close();

  p = openPage("earn.html", { storage: shared, user: { name: "Bob", email: "bob@test.dev", credits: 25 } });
  await sleep(30);
  const retryBtn = p.doc.querySelector('[data-task="camp-yt-1"]');
  check("Rejected campaign reappears for Bob with 'Try again'", !!retryBtn && retryBtn.textContent.includes("Try again") && !retryBtn.disabled);
  // Bob resubmits and owner approves -> permanently hidden even on reload
  retryBtn.click();
  p.win.FF.submitCampaignProof("bob@test.dev", "Bob", "camp-yt-1", "Updated legacy submission");
  p.win.document.dispatchEvent(new p.win.CustomEvent("ff:campaigns-synced"));
  await sleep(30);
  check("Resubmitted campaign hides immediately from Bob's screen", !p.doc.querySelector('[data-task="camp-yt-1"]'));
  const latestSub = p.win.FF.DB.campSubs().find((s) => s.worker === "bob@test.dev" && s.status === "pending");
  p.win.FF.reviewCampaignSub(latestSub.id, true);
  shared = p.snapshotStorage();
  p.win.close();

  p = openPage("earn.html", { storage: shared, user: { name: "Bob", email: "bob@test.dev" } });
  await sleep(30);
  check("Approved campaign remains hidden from Bob after reload", !p.doc.querySelector('[data-task="camp-yt-1"]'));
  p.win.close();

  /* =====================================================================
     2. ADD PAGE CAMPAIGNS (earn.html) — SERVER MODE (even with unpatched SQL)
     ===================================================================== */
  console.log("\n[2] Add Page campaigns hide on completion (earn.html — server mode)");

  const rpcCalls = [];
  let srvDone = ["camp-old-done"];
  let srvOpen = [
    { id: "camp-old-done", platform: "youtube", action: "Like", user: "Owner1", title: "Already Done", url: "https://youtube.com/watch?v=1", payout: 10, watchSecs: 0, actions: 2, maxActions: 0, mine: false, active: true, authorEmail: "o1@test.dev", created: Date.now() - 5000 },
    { id: "camp-live-2", platform: "website", action: "Visit Site", user: "Owner2", title: "Fresh Site", url: "https://example.com", payout: 15, watchSecs: 0, actions: 1, maxActions: 0, mine: false, active: true, authorEmail: "o2@test.dev", created: Date.now() - 2000 },
  ];
  let srvSubs = [{ id: "cs-1", campaignId: "camp-old-done", status: "approved", at: Date.now() - 4000 }];

  const srvEarn = openPage("earn.html", {
    serverMode: true,
    user: { name: "Bob", email: "bob@test.dev", credits: 25 },
    rpcHandler(fn, args) {
      rpcCalls.push(fn);
      if (fn === "campaigns_feed") {
        return { open: srvOpen, mine: [], mySubs: srvSubs, inbox: [], done: srvDone };
      }
      if (fn === "campaigns_submit_proof") {
        srvDone = srvDone.concat([args.p_campaign]);
        srvSubs = [{ id: "cs-2", campaignId: args.p_campaign, status: "approved", at: Date.now() }].concat(srvSubs);
        // Simulate an older server that STILL leaves the completed campaign inside `open`!
        return { open: srvOpen, mine: [], mySubs: srvSubs, inbox: [], done: srvDone };
      }
      if (fn === "wallet_state") {
        return { wallet: { available: 0, locked: 0, points: 40, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0 }, config: {}, networks: [], categories: [], txns: [], requests: [] };
      }
      return {};
    },
  });
  await sleep(60);
  check("Server mode hides already-completed campaign even if server 'open' still contains it", !srvEarn.doc.querySelector('[data-task="camp-old-done"]'));
  const liveBtn = srvEarn.doc.querySelector('[data-task="camp-live-2"]');
  check("Server mode shows uncompleted campaign", !!liveBtn);
  liveBtn.click();
  await sleep(20);
  const walletCallsBefore = rpcCalls.filter((x) => x === "wallet_state").length;
  const realNow = srvEarn.win.Date.now;
  srvEarn.win.Date.now = () => realNow() + 8000;
  await sleep(350);
  check("Server mode starts its seven-second session", rpcCalls.includes("campaigns_start"));
  check("Server mode hides campaign after automatic timer credit", !srvEarn.doc.querySelector('[data-task="camp-live-2"]'));
  check("Server mode syncs wallet_state after campaign completion", rpcCalls.filter((x) => x === "wallet_state").length > walletCallsBefore);
  srvEarn.win.close();

  /* =====================================================================
     3. QUICK BONUS MISSIONS (earn.html)
     ===================================================================== */
  console.log("\n[3] Quick bonus missions hide once completed (earn.html)");

  const bp = openPage("earn.html", { user: { name: "Bob", email: "bob@test.dev", credits: 25 } });
  await sleep(30);
  const initialBonuses = bp.doc.querySelectorAll("[data-bonus]").length;
  check("Quick bonus missions start visible", initialBonuses >= 4, initialBonuses);
  bp.doc.querySelector('[data-bonus="daily-checkin"]').click();
  bp.doc.getElementById("m-claim").disabled = false;
  bp.doc.getElementById("m-claim").click();
  await sleep(20);
  check("Completed bonus mission hides immediately from #bonus-list", !bp.doc.querySelector('[data-bonus="daily-checkin"]'));
  check("Remaining bonus missions stay visible", bp.doc.querySelectorAll("[data-bonus]").length === initialBonuses - 1);
  // Complete all remaining bonuses
  while (bp.doc.querySelector("[data-bonus]")) {
    bp.doc.querySelector("[data-bonus]").click();
    bp.doc.getElementById("m-claim").disabled = false;
    bp.doc.getElementById("m-claim").click();
    await sleep(10);
  }
  const quickPanel = bp.doc.querySelector(".quick-earn");
  check("Quick bonus section hides cleanly when all bonuses are completed", quickPanel && quickPanel.classList.contains("hidden"));
  bp.win.close();

  /* =====================================================================
     4. MICRO-JOB TASKS (tasks.html) — LOCAL + SERVER MODE
     ===================================================================== */
  console.log("\n[4] Micro-job tasks hide on completion (tasks.html — local & server)");

  let jobStorage = {
    ff_jobs: JSON.stringify([
      { id: "job-1", owner: "alice@test.dev", ownerName: "Alice", title: "Sign up for newsletter", category: "signup", description: "Join and verify email", url: "https://example.com/signup", proofNote: "Send your username", reward: 0.25, slots: 10, filled: 0, escrow: 2.50, fee: 0.125, status: "active", createdAt: Date.now() - 5000 },
    ]),
    ff_job_subs: JSON.stringify([]),
  };

  let tp = openPage("tasks.html", { storage: jobStorage, user: { name: "Bob", email: "bob@test.dev" } });
  await sleep(50);
  const jobBtn = tp.doc.querySelector('[data-job="job-1"]');
  check("Bob sees open micro-job on tasks.html", !!jobBtn);
  check("Open tasks counter shows 1", tp.doc.getElementById("s-open").textContent === "1");
  tp.win.FF.rpc = async () => new Date(Date.now() + 900000).toISOString();
  jobBtn.click();
  await sleep(20);
  tp.doc.getElementById("jm-proof").value = "Signed up with username bob_tester123";
  tp.doc.getElementById("jm-submit").click();
  await sleep(50);
  check("Micro-job hides immediately from #job-grid after submission", !tp.doc.querySelector('[data-job="job-1"]'));
  check("Open tasks counter drops to 0", tp.doc.getElementById("s-open").textContent === "0");
  check("Empty state says 'All available tasks completed!'", /All available tasks completed/i.test(tp.doc.getElementById("job-empty-title").textContent));
  check("My submissions table still displays Bob's submitted proof", tp.doc.getElementById("sub-body").textContent.includes("Sign up for newsletter"));
  jobStorage = tp.snapshotStorage();
  tp.win.close();

  // Reload tasks.html as Bob -> still hidden
  tp = openPage("tasks.html", { storage: jobStorage, user: { name: "Bob", email: "bob@test.dev" } });
  await sleep(50);
  check("Submitted micro-job stays hidden for Bob after reload", !tp.doc.querySelector('[data-job="job-1"]'));
  tp.win.close();

  // Carol still sees job-1
  tp = openPage("tasks.html", { storage: jobStorage, user: { name: "Carol", email: "carol@test.dev" } });
  await sleep(50);
  check("Another worker Carol still sees open micro-job", !!tp.doc.querySelector('[data-job="job-1"]'));
  tp.win.close();

  // Server mode defensive filter: even if server returns a submitted, full, or escrow-exhausted job in `open`
  const srvTasks = openPage("tasks.html", {
    serverMode: true,
    user: { name: "Bob", email: "bob@test.dev" },
    rpcHandler(fn) {
      if (fn === "jobs_feed") {
        return {
          categories: [{ key: "signup", name: "Sign up", color: "#22c55e" }],
          config: { platformFeePct: 5, minJobReward: 0.02 },
          open: [
            { id: "j-done", title: "Already Done Job", category: "signup", description: "desc", reward: 0.2, slots: 5, filled: 1, escrow: 0.8, status: "active", ownerName: "Owner", createdAt: Date.now() - 1000 },
            { id: "j-full", title: "Full Job", category: "signup", description: "desc", reward: 0.2, slots: 5, filled: 5, escrow: 0.2, status: "active", ownerName: "Owner", createdAt: Date.now() - 2000 },
            { id: "j-broke", title: "Zero Escrow Job", category: "signup", description: "desc", reward: 0.2, slots: 5, filled: 0, escrow: 0.05, status: "active", ownerName: "Owner", createdAt: Date.now() - 3000 },
            { id: "j-open", title: "Really Open Job", category: "signup", description: "desc", reward: 0.3, slots: 5, filled: 1, escrow: 1.2, status: "active", ownerName: "Owner", createdAt: Date.now() - 4000 },
          ],
          mine: [],
          mySubs: [{ id: "s-1", jobId: "j-done", jobTitle: "Already Done Job", reward: 0.2, proof: "done", status: "approved", at: Date.now() - 500 }],
          inbox: [],
          history: [],
        };
      }
      if (fn === "wallet_state") {
        return { wallet: { available: 1, locked: 0, points: 10, totalEarned: 1, totalDeposited: 0, totalWithdrawn: 0 }, config: {}, networks: [], categories: [], txns: [], requests: [] };
      }
      return {};
    },
  });
  await sleep(60);
  check("tasks.html hides submitted job even if present in server feed.open", !srvTasks.doc.querySelector('[data-job="j-done"]'));
  check("tasks.html hides full job (filled >= slots)", !srvTasks.doc.querySelector('[data-job="j-full"]'));
  check("tasks.html hides escrow-exhausted job (escrow < reward)", !srvTasks.doc.querySelector('[data-job="j-broke"]'));
  check("tasks.html keeps genuinely open funded job visible", !!srvTasks.doc.querySelector('[data-job="j-open"]'));
  check("tasks.html s-open counts only truly open jobs (1)", srvTasks.doc.getElementById("s-open").textContent === "1");
  srvTasks.win.close();

  /* =====================================================================
     5. "IN ESCROW / PENDING" BREAKDOWN & SERVER SYNC (dashboard & wallet)
     ===================================================================== */
  console.log("\n[5] In escrow / pending breakdown on dashboard.html & wallet.html");

  const escRpc = (lockedVal, reqs, myJobs) => (fn) => {
    if (fn === "wallet_state") {
      return {
        wallet: { available: 65.64, locked: lockedVal, points: 126, totalEarned: 183.47, totalDeposited: 0, totalWithdrawn: 0 },
        config: { minDeposit: 10, minWithdraw: 10, withdrawFeePct: 1, platformFeePct: 5, minPointsConvert: 1000, minUsdtConvert: 0.1, minJobReward: 0.02, pointsPerUsdt: 1000 },
        networks: [{ network: "USDT-BEP20", address: "0xabc", deposit: true, withdraw: true }],
        categories: [{ key: "signup", name: "Sign up", color: "#22c55e" }],
        txns: [],
        requests: reqs,
      };
    }
    if (fn === "jobs_feed" || fn === "jobs_cancel") {
      return { categories: [], config: { platformFeePct: 5, minJobReward: 0.02 }, open: [], mine: myJobs, mySubs: [], inbox: [], history: [] };
    }
    if (fn === "campaigns_feed") return { open: [], mine: [], mySubs: [], inbox: [], done: [] };
    if (fn === "mining_state") return { ghs: 0, unclaimed: 0, claimed: 0, boost: 0, config: { minClaimUsdt: 0.01 }, plans: [], rigs: [] };
    return {};
  };

  // Case A: $7.50 held for 1 posted task (matches user's exact live state)
  const dashEscrow = openPage("dashboard.html", {
    serverMode: true,
    user: { name: "Admin", email: "ravanyt001@gmail.com" },
    rpcHandler: escRpc(7.50, [], [
      { id: "job-gmail", title: "Gmail: Create an Account", category: "signup", reward: 0.15, slots: 50, filled: 0, escrow: 7.50, fee: 0.375, status: "active", createdAt: Date.now() },
    ]),
  });
  await sleep(80);
  const lockedChip = dashEscrow.doc.querySelector("[data-usdt-locked]");
  const lockedDetail = dashEscrow.doc.getElementById("db-locked-detail");
  check("Dashboard [data-usdt-locked] still displays exact '7.50'", lockedChip && lockedChip.textContent === "7.50", lockedChip && lockedChip.textContent);
  check("Dashboard explains $7.50 held for 1 posted task", lockedDetail && /\$7\.50 held for 1 posted task/i.test(lockedDetail.textContent), lockedDetail && lockedDetail.textContent);
  check("Dashboard links directly to my-tasks.html (manage / refund)", lockedDetail && !!lockedDetail.querySelector('a[href="my-tasks.html"]'));
  dashEscrow.win.close();

  // Case B: wallet.html with BOTH $7.50 task escrow AND $10.00 pending withdrawal = $17.50
  const walBoth = openPage("wallet.html", {
    serverMode: true,
    user: { name: "Admin", email: "ravanyt001@gmail.com" },
    rpcHandler: escRpc(17.50, [
      { id: "wd-1", kind: "withdraw", amount: 10.00, fee: 0.10, receive: 9.90, network: "USDT-BEP20", address: "0x123", status: "pending", at: Date.now() },
    ], []),
  });
  await sleep(80);
  const wLocked = walBoth.doc.getElementById("w-locked");
  const wLockedNote = walBoth.doc.getElementById("w-locked-note");
  check("Wallet #w-locked displays '17.50 USDT'", wLocked && wLocked.textContent.trim() === "17.50 USDT", wLocked && wLocked.textContent.trim());
  check("Wallet #w-locked-note splits $7.50 posted task escrow and $10.00 pending withdrawal",
    wLockedNote && /\$7\.50 in posted task escrow/i.test(wLockedNote.textContent) && /\$10\.00 in pending withdrawals/i.test(wLockedNote.textContent),
    wLockedNote && wLockedNote.textContent);
  check("Wallet #w-locked-note links to my-tasks.html and #requests",
    wLockedNote && !!wLockedNote.querySelector('a[href="my-tasks.html"]') && !!wLockedNote.querySelector('a[data-goto="requests"]'));

  // Case C: server-mode api.cancelJob() automatically triggers a wallet_state refresh
  let cancelWalletSyncs = 0;
  const origRpc = walBoth.win.FF.rpc;
  walBoth.win.FF.rpc = (fn, args) => {
    if (fn === "wallet_state") cancelWalletSyncs++;
    return origRpc(fn, args);
  };
  await walBoth.win.FF.W.api.cancelJob("job-gmail");
  await sleep(40);
  check("Server-mode cancelJob() refreshes wallet_state so locked escrow updates immediately", cancelWalletSyncs >= 1, cancelWalletSyncs);
  walBoth.win.close();

  /* =====================================================================
     6. SQL MIGRATION & CANONICAL SQL CHECKS
     ===================================================================== */
  console.log("\n[6] SQL migration (#26) & canonical SQL definitions");

  const clickSql = fs.readFileSync(path.join(ROOT, "supabase-campaign-click-7s.sql"), "utf8");
  check("Server claims enforce a seven-second clock and private per-worker starts", /clock_timestamp\(\) < v_started \+ interval '7 seconds'/.test(clickSql) && /primary key\(campaign_id,worker\)/.test(clickSql) && /revoke all on public.campaign_click_sessions/.test(clickSql));
  check("Server claims preserve quota and referral payouts without proof validation", /c.actions >= c.max_actions/.test(clickSql) && /referral_payout/.test(clickSql) && !/length\(trim\(p_proof\)\)/.test(clickSql));
  const sql26 = fs.readFileSync(path.join(ROOT, "supabase-hide-completed-tasks.sql"), "utf8");
  const sqlTopBid = fs.readFileSync(path.join(ROOT, "supabase-campaigns-top-bid.sql"), "utf8");
  const sqlPostAdmin = fs.readFileSync(path.join(ROOT, "supabase-post-task-admin.sql"), "utf8");
  const sqlWallet = fs.readFileSync(path.join(ROOT, "supabase-wallet.sql"), "utf8");

  check("supabase-hide-completed-tasks.sql excludes approved/pending market_campaign_subs from campaigns_feed open",
    /market_campaign_subs[\s\S]*s\.status in \('approved', 'pending'\)/.test(sql26));
  check("supabase-hide-completed-tasks.sql requires jb.escrow >= jb.reward in jobs_feed open",
    /jb\.status = 'active' and jb\.filled < jb\.slots and jb\.escrow >= jb\.reward/.test(sql26));
  check("supabase-campaigns-top-bid.sql carries the same completed-campaign filter",
    /market_campaign_subs[\s\S]*s\.status in \('approved', 'pending'\)/.test(sqlTopBid));
  check("supabase-post-task-admin.sql carries jb.escrow >= jb.reward in jobs_feed open",
    /jb\.status = 'active' and jb\.filled < jb\.slots and jb\.escrow >= jb\.reward/.test(sqlPostAdmin));
  check("supabase-wallet.sql carries jb.escrow >= jb.reward in jobs_feed open",
    /jb\.status = 'active' and jb\.filled < jb\.slots and jb\.escrow >= jb\.reward/.test(sqlWallet));

  console.log("\nSummary:", pass, "passed,", fail, "failed");
  process.exit(fail > 0 ? 1 : 0);
})();
