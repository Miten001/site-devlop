/* ============================================================
   FLEXFAM — USDT wallet + task marketplace engine
   Browser-side ledger (localStorage) used by wallet.html, tasks.html,
   post-task.html, my-tasks.html and admin-payments.html.
   NOTE: this is a front-end simulation of the money flow. Real deposits /
   withdrawals must be settled by your backend or payment processor.
   ============================================================ */
(function () {
  "use strict";

  if (!window.FF) return;
  const store = FF.store;

  const CFG = {
    minDeposit: 5,
    minWithdraw: 10,
    withdrawFeePct: 1,        // network + processing fee
    platformFeePct: 5,        // charged to task creators on escrow
    networks: ["TRC20 (Tron)", "BEP20 (BSC)", "Polygon", "TON"],
    depositAddress: {
      "TRC20 (Tron)": "TJ9FlexFamUSDTdepositWallet8sQ2xA",
      "BEP20 (BSC)": "0xFLEXfam4d21b9e7c5a8d0f6b3c1e9a7d2f4b6c8e0",
      "Polygon": "0xFLEXpoly7c2a9d4f1b6e3c8a5d0f2b7e9c4a1d6f3",
      "TON": "UQFlexFamTonDepositWalletAddr9x7Kd2",
    },
    pointsPerUsdt: 1000,       // points -> USDT conversion rate
    minPointsConvert: 1000,
  };

  /* ---------- low level ---------- */
  function wallets() { return store.get("ff_wallets", {}); }
  function saveWallets(w) { store.set("ff_wallets", w); }

  function wallet(email) {
    const all = wallets();
    if (!all[email]) {
      all[email] = { available: 0, locked: 0, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0, txns: [] };
      saveWallets(all);
    }
    return all[email];
  }

  function patchWallet(email, fn) {
    const all = wallets();
    if (!all[email]) all[email] = { available: 0, locked: 0, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0, txns: [] };
    fn(all[email]);
    saveWallets(all);
    syncWalletPills();
    return all[email];
  }

  function uid(prefix) {
    const bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now(); bytes[1] = Math.floor(Math.random() * 1e9); }
    return (prefix || "id") + "_" + Array.from(bytes).map((n) => n.toString(36)).join("");
  }

  function money(n) {
    return (Math.round(Number(n || 0) * 10000) / 10000).toFixed(Number(n) % 1 === 0 ? 2 : 4).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, ".00");
  }

  function usd(n) { return "$" + Number(n || 0).toFixed(2); }

  function tx(email, type, amount, note, status, meta) {
    patchWallet(email, (w) => {
      w.txns.unshift(Object.assign({
        id: uid("tx"), type, amount: Number(amount), note: note || "", status: status || "completed", at: Date.now(),
      }, meta || {}));
      w.txns = w.txns.slice(0, 200);
    });
  }

  /* ---------- deposits / withdrawals ---------- */
  function requests() { return store.get("ff_pay_requests", []); }
  function saveRequests(r) { store.set("ff_pay_requests", r); }

  function createDeposit(email, name, amount, network, txid) {
    amount = Number(amount);
    if (!(amount >= CFG.minDeposit)) throw new Error("Minimum deposit is " + usd(CFG.minDeposit) + " USDT");
    if (!network) throw new Error("Select a network");
    if (!txid || txid.trim().length < 8) throw new Error("Paste the transaction hash (TXID) from your wallet");
    const req = {
      id: uid("dep"), kind: "deposit", email, name: name || email, amount,
      network, txid: txid.trim(), status: "pending", at: Date.now(),
    };
    const all = requests(); all.unshift(req); saveRequests(all);
    tx(email, "deposit", amount, "Deposit via " + network, "pending", { refId: req.id });
    return req;
  }

  function createWithdraw(email, name, amount, network, address) {
    amount = Number(amount);
    const w = wallet(email);
    if (!(amount >= CFG.minWithdraw)) throw new Error("Minimum withdrawal is " + usd(CFG.minWithdraw) + " USDT");
    if (amount > w.available) throw new Error("Not enough available balance");
    if (!network) throw new Error("Select a network");
    if (!address || address.trim().length < 15) throw new Error("Enter a valid USDT wallet address");
    const fee = Math.round(amount * CFG.withdrawFeePct) / 100;
    patchWallet(email, (acc) => { acc.available -= amount; acc.locked += amount; });
    const req = {
      id: uid("wd"), kind: "withdraw", email, name: name || email, amount, fee,
      receive: Math.round((amount - fee) * 100) / 100,
      network, address: address.trim(), status: "pending", at: Date.now(),
    };
    const all = requests(); all.unshift(req); saveRequests(all);
    tx(email, "withdraw", -amount, "Withdrawal to " + network + " (fee " + usd(fee) + ")", "pending", { refId: req.id });
    return req;
  }

  function settleRequest(id, approve) {
    const all = requests();
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Request not found");
    const r = all[i];
    if (r.status !== "pending") throw new Error("Already settled");
    r.status = approve ? "approved" : "rejected";
    r.settledAt = Date.now();
    saveRequests(all);

    patchWallet(r.email, (acc) => {
      if (r.kind === "deposit") {
        if (approve) { acc.available += r.amount; acc.totalDeposited += r.amount; }
      } else if (r.kind === "withdraw") {
        acc.locked -= r.amount;
        if (approve) acc.totalWithdrawn += r.amount;
        else acc.available += r.amount;
      }
      const t = acc.txns.find((x) => x.refId === r.id);
      if (t) t.status = approve ? "completed" : "rejected";
    });
    return r;
  }

  function myRequests(email) { return requests().filter((r) => r.email === email); }

  /* ---------- task marketplace ---------- */
  function jobs() { return store.get("ff_jobs", []); }
  function saveJobs(j) { store.set("ff_jobs", j); }
  function subs() { return store.get("ff_job_subs", []); }
  function saveSubs(s) { store.set("ff_job_subs", s); }

  const CATEGORIES = [
    { key: "social", name: "Social Media", color: "#e0489f" },
    { key: "app", name: "App Install & Review", color: "#22d3ee" },
    { key: "signup", name: "Sign Up / Referral", color: "#34e5a5" },
    { key: "content", name: "Content & Writing", color: "#ffd166" },
    { key: "video", name: "Video & Watch Time", color: "#ff3355" },
    { key: "crypto", name: "Crypto & Airdrop", color: "#a970ff" },
    { key: "survey", name: "Survey & Feedback", color: "#2aabee" },
    { key: "other", name: "Other Micro Work", color: "#ff8a3d" },
  ];

  function category(key) { return CATEGORIES.find((c) => c.key === key) || CATEGORIES[CATEGORIES.length - 1]; }

  function postJob(email, name, data) {
    const reward = Number(data.reward);
    const slots = parseInt(data.slots, 10);
    if (!data.title || data.title.trim().length < 6) throw new Error("Task title must be at least 6 characters");
    if (!data.description || data.description.trim().length < 20) throw new Error("Describe the task in at least 20 characters");
    if (!(reward >= 0.02)) throw new Error("Minimum reward is $0.02 per worker");
    if (!(slots >= 1)) throw new Error("At least 1 worker slot is required");
    const budget = reward * slots;
    const fee = Math.round(budget * CFG.platformFeePct) / 100;
    const total = Math.round((budget + fee) * 10000) / 10000;
    const w = wallet(email);
    if (w.available < total) throw new Error("Need " + usd(total) + " USDT in your wallet (incl. " + CFG.platformFeePct + "% fee). Deposit first.");

    patchWallet(email, (acc) => { acc.available -= total; acc.locked += budget; });
    const job = {
      id: uid("job"), owner: email, ownerName: name || email.split("@")[0],
      title: data.title.trim(), category: data.category || "other",
      description: data.description.trim(), url: (data.url || "").trim(),
      proofNote: (data.proofNote || "Screenshot / proof link of the completed action").trim(),
      reward, slots, filled: 0, escrow: budget, fee,
      status: "active", createdAt: Date.now(),
    };
    const all = jobs(); all.unshift(job); saveJobs(all);
    tx(email, "escrow", -total, 'Escrow for task "' + job.title + '" (' + slots + " slots + " + CFG.platformFeePct + "% fee)", "completed", { jobId: job.id });
    return job;
  }

  function openJobs(excludeEmail) {
    const done = subs();
    return jobs().filter((j) => j.status === "active" && j.filled < j.slots && j.owner !== excludeEmail)
      .filter((j) => !done.some((s) => s.jobId === j.id && s.worker === excludeEmail));
  }

  function myJobs(email) { return jobs().filter((j) => j.owner === email); }
  function jobSubs(jobId) { return subs().filter((s) => s.jobId === jobId); }
  function mySubs(email) { return subs().filter((s) => s.worker === email); }

  function submitProof(email, name, jobId, proof, note) {
    const job = jobs().find((j) => j.id === jobId);
    if (!job) throw new Error("Task not found");
    if (job.owner === email) throw new Error("You cannot work on your own task");
    if (job.status !== "active" || job.filled >= job.slots) throw new Error("This task is already full");
    if (subs().some((s) => s.jobId === jobId && s.worker === email)) throw new Error("You already submitted this task");
    if (!proof || proof.trim().length < 6) throw new Error("Add your proof (link, screenshot URL, username or ID)");
    const sub = {
      id: uid("sub"), jobId, jobTitle: job.title, reward: job.reward,
      worker: email, workerName: name || email.split("@")[0], owner: job.owner,
      proof: proof.trim(), note: (note || "").trim(), status: "pending", at: Date.now(),
    };
    const all = subs(); all.unshift(sub); saveSubs(all);
    return sub;
  }

  function reviewSub(subId, approve, reason) {
    const all = subs();
    const i = all.findIndex((s) => s.id === subId);
    if (i < 0) throw new Error("Submission not found");
    const s = all[i];
    if (s.status !== "pending") throw new Error("Already reviewed");
    const list = jobs();
    const j = list.find((x) => x.id === s.jobId);
    if (!j) throw new Error("Task not found");

    s.status = approve ? "approved" : "rejected";
    s.reason = reason || "";
    s.reviewedAt = Date.now();
    saveSubs(all);

    if (approve) {
      patchWallet(j.owner, (acc) => { acc.locked -= j.reward; });
      patchWallet(s.worker, (acc) => { acc.available += j.reward; acc.totalEarned += j.reward; });
      tx(j.owner, "payout", -j.reward, 'Paid ' + s.workerName + ' for "' + j.title + '"', "completed", { jobId: j.id });
      tx(s.worker, "earning", j.reward, 'Task approved: "' + j.title + '"', "completed", { jobId: j.id });
      j.filled += 1;
      if (j.filled >= j.slots) j.status = "completed";
      saveJobs(list);
    }
    return s;
  }

  function cancelJob(email, jobId) {
    const list = jobs();
    const j = list.find((x) => x.id === jobId);
    if (!j || j.owner !== email) throw new Error("Task not found");
    if (j.status === "cancelled") throw new Error("Already cancelled");
    const remaining = Math.max(0, j.slots - j.filled) * j.reward;
    j.status = "cancelled";
    saveJobs(list);
    if (remaining > 0) {
      patchWallet(email, (acc) => { acc.locked -= remaining; acc.available += remaining; });
      tx(email, "refund", remaining, 'Refund from cancelled task "' + j.title + '"', "completed", { jobId: j.id });
    }
    return j;
  }

  /* ---------- points -> USDT ---------- */
  function convertPoints(email, points) {
    points = parseInt(points, 10);
    const user = FF.currentUser();
    if (!user) throw new Error("Please log in");
    if (!(points >= CFG.minPointsConvert)) throw new Error("Minimum " + CFG.minPointsConvert + " points to convert");
    if ((user.credits || 0) < points) throw new Error("Not enough points");
    const amount = Math.round((points / CFG.pointsPerUsdt) * 10000) / 10000;
    FF.spendCredits(email, points, "Converted " + points + " points to " + usd(amount) + " USDT");
    patchWallet(email, (acc) => { acc.available += amount; acc.totalEarned += amount; });
    tx(email, "convert", amount, points + " points converted to USDT", "completed");
    return amount;
  }

  /* ---------- demo marketplace seed ---------- */
  const SEED_JOBS = [
    { id: "seedjob1", owner: "growth@flexfam.io", ownerName: "GrowthLab", category: "social",
      title: "Subscribe to my YouTube channel and like the latest video",
      description: "1. Open the channel link\n2. Subscribe with a real account (no throwaways)\n3. Like the most recent video\n4. Send a screenshot showing your subscribed state",
      url: "https://youtube.com", proofNote: "Screenshot link + your YouTube handle", reward: 0.12, slots: 80, filled: 23 },
    { id: "seedjob2", owner: "appteam@flexfam.io", ownerName: "AppBoost Media", category: "app",
      title: "Install our Android app and leave an honest 5-star review",
      description: "1. Install the app from Play Store\n2. Use it for at least 2 minutes\n3. Leave an honest review (min 10 words)\n4. Share your review screenshot and reviewer name",
      url: "https://play.google.com", proofNote: "Review screenshot + reviewer name", reward: 0.45, slots: 40, filled: 11 },
    { id: "seedjob3", owner: "crypto@flexfam.io", ownerName: "AirdropHunter", category: "crypto",
      title: "Join our Telegram airdrop group and complete the captcha",
      description: "1. Join the Telegram group\n2. Complete the captcha in the welcome bot\n3. Stay in the group for at least 7 days\n4. Send your Telegram @username",
      url: "https://t.me/sub_for_sub_bot?start=web_bonus", proofNote: "Your Telegram @username", reward: 0.08, slots: 200, filled: 87 },
    { id: "seedjob4", owner: "surveys@flexfam.io", ownerName: "InsightPanel", category: "survey",
      title: "Complete a 3-minute product feedback survey",
      description: "1. Open the survey form\n2. Answer all 10 questions honestly\n3. Copy the completion code shown at the end\n4. Paste the completion code as your proof",
      url: "https://example.com/survey", proofNote: "Survey completion code", reward: 0.25, slots: 60, filled: 34 },
    { id: "seedjob5", owner: "writers@flexfam.io", ownerName: "ContentKart", category: "content",
      title: "Write a 150-word blog comment on our article",
      description: "1. Read the article fully\n2. Write a genuine, on-topic comment of at least 150 words\n3. No spam, no links\n4. Submit the direct link to your comment",
      url: "https://example.com/blog", proofNote: "Direct link to your published comment", reward: 0.60, slots: 25, filled: 6 },
    { id: "seedjob6", owner: "signupdesk@flexfam.io", ownerName: "ReferPro", category: "signup",
      title: "Sign up on our platform using my referral link and verify email",
      description: "1. Register through the referral link\n2. Verify your email address\n3. Complete your profile\n4. Send your registered username",
      url: "https://example.com/?ref=flexfam", proofNote: "Your registered username / user ID", reward: 0.35, slots: 100, filled: 41 },
    { id: "seedjob7", owner: "videoads@flexfam.io", ownerName: "StreamPush", category: "video",
      title: "Watch a 5-minute video fully and answer one question",
      description: "1. Watch the entire video without skipping\n2. Note the word shown at minute 4:30\n3. Submit that word as your proof",
      url: "https://youtube.com", proofNote: "The secret word from the video", reward: 0.10, slots: 150, filled: 62 },
    { id: "seedjob8", owner: "instapush@flexfam.io", ownerName: "ReelRocket", category: "social",
      title: "Follow my Instagram page and save 3 posts",
      description: "1. Follow the page from a real account\n2. Save any 3 posts\n3. Like the pinned reel\n4. Send your Instagram handle",
      url: "https://instagram.com", proofNote: "Your Instagram handle", reward: 0.09, slots: 120, filled: 58 },
  ];

  function seedMarketplace() {
    if (store.get("ff_jobs_seeded", 0) >= 1) return;
    const existing = jobs();
    const have = existing.map((j) => j.id);
    SEED_JOBS.forEach((j) => {
      if (have.indexOf(j.id) > -1) return;
      existing.push(Object.assign({
        escrow: j.reward * j.slots, fee: 0, status: "active",
        createdAt: Date.now() - Math.floor(Math.random() * 6 + 1) * 3600000,
      }, j));
    });
    saveJobs(existing);
    store.set("ff_jobs_seeded", 1);

    /* give the demo account a usable starting balance */
    const me = FF.currentUser();
    if (me && me.email === "demo@flexfam.io" && !wallet(me.email).totalDeposited) {
      patchWallet(me.email, (acc) => { acc.available = 25; acc.totalDeposited = 25; });
      tx(me.email, "deposit", 25, "Demo starting balance", "completed");
    }
  }

  /* ---------- UI helpers ---------- */
  function syncWalletPills() {
    const u = FF.currentUser();
    const w = u ? wallet(u.email) : { available: 0, locked: 0 };
    document.querySelectorAll("[data-usdt]").forEach((el) => { el.textContent = Number(w.available).toFixed(2); });
    document.querySelectorAll("[data-usdt-locked]").forEach((el) => { el.textContent = Number(w.locked).toFixed(2); });
  }

  const USDT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5L1.2 8.1 12 22.5 22.8 8.1 12 1.5zm1.6 9.7v1.6c-.5.03-1.05.05-1.6.05s-1.1-.02-1.6-.05v-1.6c-2.6-.13-4.5-.66-4.5-1.3 0-.63 1.9-1.17 4.5-1.3v1.45c.5.03 1.03.05 1.6.05s1.1-.02 1.6-.05V8.6c2.6.13 4.5.67 4.5 1.3 0 .64-1.9 1.17-4.5 1.3zM12 12.1c3.2 0 5.9-.5 6.6-1.16v1.1c0 .74-2.95 1.34-6.6 1.34s-6.6-.6-6.6-1.34v-1.1c.7.66 3.4 1.16 6.6 1.16z"/></svg>';

  document.addEventListener("DOMContentLoaded", () => {
    seedMarketplace();
    document.querySelectorAll("[data-usdt-icon]").forEach((el) => (el.innerHTML = USDT_SVG));
    syncWalletPills();
  });

  FF.W = {
    CFG, CATEGORIES, category, money, usd, uid,
    wallet, patchWallet, tx,
    createDeposit, createWithdraw, settleRequest, requests, myRequests,
    jobs, openJobs, myJobs, postJob, cancelJob,
    subs, jobSubs, mySubs, submitProof, reviewSub,
    convertPoints, syncWalletPills, seedMarketplace, USDT_SVG,
  };
})();
