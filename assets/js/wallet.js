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
    minDeposit: 10,
    minWithdraw: 5,
    withdrawFeePct: 1,        // network + processing fee
    platformFeePct: 5,        // charged to task creators on escrow
    /* Only networks with a real, verified receiving wallet are listed here.
       Add more entries to depositAddress (and to this list) once you have a
       confirmed address for that chain — never ship a placeholder. */
    networks: ["BEP20 (BSC)"],
    depositAddress: {
      "BEP20 (BSC)": "0xe85d1b6b330219de89e826f314a9bc2bcd595e53",
    },
    depositQr: {
      "BEP20 (BSC)": "assets/img/deposit-bep20-qr.png",
    },
    networkNote: {
      "BEP20 (BSC)": "BNB Smart Chain (BEP20) only. Do not send NFTs or any other token to this address.",
    },
    /* Withdrawals are also BEP20 (BSC) only, same network as deposits. */
    withdrawNetworks: ["BEP20 (BSC)"],
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
    if (!network || !CFG.depositAddress[network]) throw new Error("Select a supported deposit network");
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
    if (!network || CFG.withdrawNetworks.indexOf(network) < 0) throw new Error("Select a network");
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
      j.escrow = Math.round(Math.max(0, (j.escrow || 0) - j.reward) * 10000) / 10000;
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
    j.escrow = 0;
    saveJobs(list);
    if (remaining > 0) {
      patchWallet(email, (acc) => { acc.locked -= remaining; acc.available += remaining; });
      tx(email, "refund", remaining, 'Refund from cancelled task "' + j.title + '"', "completed", { jobId: j.id });
    }
    return j;
  }

  /* ---------- admin overrides ---------- */
  function adminCancelJob(jobId) {
    const list = jobs();
    const j = list.find((x) => x.id === jobId);
    if (!j) throw new Error("Task not found");
    return cancelJob(j.owner, jobId);
  }

  function adminSetJobStatus(jobId, status) {
    const list = jobs();
    const j = list.find((x) => x.id === jobId);
    if (!j) throw new Error("Task not found");
    j.status = status;
    saveJobs(list);
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

  /* ---------- one-time cleanup of the old demo listings ----------
     Earlier builds injected sample "seedjob*" tasks and a fake demo
     balance into localStorage. Strip them so the market only ever
     shows real, user-posted work. */
  function purgeDemoData() {
    if (store.get("ff_demo_purged", 0) >= 1) return;

    const cleanJobs = jobs().filter((j) => !/^seedjob/.test(String(j.id || "")));
    saveJobs(cleanJobs);

    const keep = cleanJobs.map((j) => j.id);
    saveSubs(subs().filter((s) => keep.indexOf(s.jobId) > -1));

    const all = wallets();
    Object.keys(all).forEach((email) => {
      const w = all[email];
      w.txns = (w.txns || []).filter((t) => t.note !== "Demo starting balance");
    });
    saveWallets(all);

    store.set("ff_jobs_seeded", 0);
    store.set("ff_demo_purged", 1);
  }

  /* ---------- UI helpers ---------- */
  function syncWalletPills() {
    const u = FF.currentUser();
    const w = u ? wallet(u.email) : { available: 0, locked: 0 };
    document.querySelectorAll("[data-usdt]").forEach((el) => { el.textContent = Number(w.available).toFixed(2); });
    document.querySelectorAll("[data-usdt-locked]").forEach((el) => { el.textContent = Number(w.locked).toFixed(2); });
  }

  const USDT_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5L1.2 8.1 12 22.5 22.8 8.1 12 1.5zm1.6 9.7v1.6c-.5.03-1.05.05-1.6.05s-1.1-.02-1.6-.05v-1.6c-2.6-.13-4.5-.66-4.5-1.3 0-.63 1.9-1.17 4.5-1.3v1.45c.5.03 1.03.05 1.6.05s1.1-.02 1.6-.05V8.6c2.6.13 4.5.67 4.5 1.3 0 .64-1.9 1.17-4.5 1.3zM12 12.1c3.2 0 5.9-.5 6.6-1.16v1.1c0 .74-2.95 1.34-6.6 1.34s-6.6-.6-6.6-1.34v-1.1c.7.66 3.4 1.16 6.6 1.16z"/></svg>';

  /* ============================================================
     SERVER LAYER
     When Supabase is configured and the member holds a real Auth session,
     the wallet, escrow and marketplace live in Postgres (supabase-wallet.sql).
     Balances, fees and escrow releases are computed there inside a single
     transaction, so editing localStorage changes nothing. Without a session
     everything falls back to the browser simulation above, which keeps local
     previews and demo accounts working.
     ============================================================ */

  let serverDown = false;   // set after an auth/offline failure
  let lastWallet = null;    // last wallet_state payload
  let lastFeed = null;      // last jobs_feed payload

  function serverReady() {
    return !!(FF.hasServer && FF.hasServer() && !serverDown);
  }

  /* Any RPC failure that is an auth/config problem drops us into local mode
     for the rest of the session; a real validation error is re-thrown. */
  function call(fn, args) {
    return FF.rpc(fn, args).catch((err) => {
      if (err && err.offline) { serverDown = true; throw Object.assign(err, { fellBack: true }); }
      throw err;
    });
  }

  function num(n) { return Number(n || 0); }

  /* Server payload -> the shape the pages render, identical in both modes. */
  function adoptWallet(payload) {
    lastWallet = payload;
    const cfg = payload.config || {};
    const nets = payload.networks || [];
    const view = {
      mode: "server",
      config: {
        minDeposit: num(cfg.minDeposit) || CFG.minDeposit,
        minWithdraw: num(cfg.minWithdraw) || CFG.minWithdraw,
        withdrawFeePct: num(cfg.withdrawFeePct),
        platformFeePct: num(cfg.platformFeePct),
        minPointsConvert: num(cfg.minPointsConvert) || CFG.minPointsConvert,
        minJobReward: num(cfg.minJobReward) || 0.02,
        pointsPerUsdt: num(cfg.pointsPerUsdt) || CFG.pointsPerUsdt,
      },
      networks: nets.map((n) => ({
        network: n.network, address: n.address, qr: n.qr, note: n.note,
        deposit: n.deposit !== false, withdraw: n.withdraw !== false,
      })),
      categories: (payload.categories || []).map((c) => ({ key: c.key, name: c.name, color: c.color })),
      wallet: {
        available: num((payload.wallet || {}).available),
        locked: num((payload.wallet || {}).locked),
        points: num((payload.wallet || {}).points),
        totalEarned: num((payload.wallet || {}).totalEarned),
        totalDeposited: num((payload.wallet || {}).totalDeposited),
        totalWithdrawn: num((payload.wallet || {}).totalWithdrawn),
      },
      txns: (payload.txns || []).map((t) => ({
        id: t.id, type: t.type, amount: num(t.amount), note: t.note || "",
        status: t.status, at: num(t.at),
      })),
      requests: (payload.requests || []).map((r) => ({
        id: r.id, kind: r.kind, amount: num(r.amount), fee: num(r.fee), receive: num(r.receive),
        network: r.network, address: r.address, txid: r.txid, status: r.status, at: num(r.at),
      })),
    };
    paintPills(view.wallet);
    return view;
  }

  function adoptFeed(payload) {
    lastFeed = payload;
    const cfg = payload.config || {};
    const job = (j) => ({
      id: j.id, title: j.title, category: j.category, description: j.description,
      url: j.url || "", proofNote: j.proofNote || "", reward: num(j.reward),
      slots: num(j.slots), filled: num(j.filled), escrow: num(j.escrow), fee: num(j.fee),
      status: j.status || "active", ownerName: j.ownerName || "",
      createdAt: num(j.createdAt),
    });
    const sub = (s) => ({
      id: s.id, jobId: s.jobId, jobTitle: s.jobTitle, reward: num(s.reward),
      proof: s.proof, note: s.note || "", reason: s.reason || "",
      workerName: s.workerName || "", status: s.status, at: num(s.at),
    });
    return {
      mode: "server",
      config: {
        platformFeePct: num(cfg.platformFeePct),
        minJobReward: num(cfg.minJobReward) || 0.02,
      },
      categories: (payload.categories || []).map((c) => ({ key: c.key, name: c.name, color: c.color })),
      open: (payload.open || []).map(job),
      mine: (payload.mine || []).map(job),
      mySubs: (payload.mySubs || []).map(sub),
      inbox: (payload.inbox || []).map(sub),
    };
  }

  /* Local equivalents of the two server payloads, same shape. */
  function localWalletView(email) {
    const w = wallet(email);
    const user = FF.currentUser() || {};
    return {
      mode: "local",
      config: {
        minDeposit: CFG.minDeposit, minWithdraw: CFG.minWithdraw,
        withdrawFeePct: CFG.withdrawFeePct, platformFeePct: CFG.platformFeePct,
        minPointsConvert: CFG.minPointsConvert, minJobReward: 0.02,
        pointsPerUsdt: CFG.pointsPerUsdt,
      },
      networks: CFG.networks.map((n) => ({
        network: n, address: CFG.depositAddress[n], qr: CFG.depositQr[n],
        note: CFG.networkNote[n],
        deposit: true, withdraw: CFG.withdrawNetworks.indexOf(n) > -1,
      })),
      categories: CATEGORIES,
      wallet: {
        available: num(w.available), locked: num(w.locked), points: num(user.credits),
        totalEarned: num(w.totalEarned), totalDeposited: num(w.totalDeposited),
        totalWithdrawn: num(w.totalWithdrawn),
      },
      txns: (w.txns || []).slice(0, 60),
      requests: myRequests(email),
    };
  }

  function localFeedView(email) {
    const name = (FF.currentUser() || {}).name;
    const mine = myJobs(email);
    const ids = mine.map((j) => j.id);
    return {
      mode: "local",
      config: { platformFeePct: CFG.platformFeePct, minJobReward: 0.02 },
      categories: CATEGORIES,
      open: openJobs(email).map((j) => Object.assign({}, j, { ownerName: j.ownerName || name || "Member" })),
      mine,
      mySubs: mySubs(email),
      inbox: subs().filter((s) => ids.indexOf(s.jobId) > -1 && s.status === "pending"),
    };
  }

  function paintPills(w) {
    document.querySelectorAll("[data-usdt]").forEach((el) => { el.textContent = num(w.available).toFixed(2); });
    document.querySelectorAll("[data-usdt-locked]").forEach((el) => { el.textContent = num(w.locked).toFixed(2); });
    document.querySelectorAll("[data-credits]").forEach((el) => { el.textContent = num(w.points).toLocaleString("en-IN"); });
  }

  /* Every mutation returns the fresh view, so pages just re-render. */
  function remote(fn, args, localFn, kind) {
    const u = FF.currentUser();
    if (!u) return Promise.reject(new Error("Please log in"));
    const fallback = () => (kind === "feed" ? localFeedView(u.email) : localWalletView(u.email));
    const runLocal = () => Promise.resolve().then(() => { if (localFn) localFn(u); return fallback(); });
    if (!serverReady()) return runLocal();
    return call(fn, args)
      .then((payload) => (kind === "feed" ? adoptFeed(payload) : adoptWallet(payload)))
      .catch((err) => { if (err.fellBack) return runLocal(); throw err; });
  }

  const api = {
    isServer() { return serverReady(); },

    /* --- wallet --- */
    wallet() { return remote("wallet_state", null, null, "wallet"); },

    createDeposit(amount, network, txid) {
      return remote("wallet_create_deposit",
        { p_amount: Number(amount), p_network: network, p_txid: String(txid || "").trim() },
        (u) => createDeposit(u.email, u.name, amount, network, txid), "wallet");
    },

    createWithdraw(amount, network, address) {
      return remote("wallet_create_withdraw",
        { p_amount: Number(amount), p_network: network, p_address: String(address || "").trim() },
        (u) => createWithdraw(u.email, u.name, amount, network, address), "wallet");
    },

    convertPoints(points) {
      return remote("wallet_convert_points", { p_points: parseInt(points, 10) },
        (u) => convertPoints(u.email, points), "wallet");
    },

    /* --- marketplace --- */
    feed() { return remote("jobs_feed", null, null, "feed"); },

    postJob(data) {
      return remote("jobs_post", {
        p_title: data.title, p_category: data.category, p_description: data.description,
        p_url: data.url || "", p_proof_note: data.proofNote || "",
        p_reward: Number(data.reward), p_slots: parseInt(data.slots, 10),
      }, (u) => postJob(u.email, u.name, data), "feed");
    },

    submitProof(jobId, proof, note) {
      return remote("jobs_submit_proof", { p_job: jobId, p_proof: proof, p_note: note || "" },
        (u) => submitProof(u.email, u.name, jobId, proof, note), "feed");
    },

    reviewSub(subId, approve, reason) {
      return remote("jobs_review", { p_sub: subId, p_approve: !!approve, p_reason: reason || "" },
        () => reviewSub(subId, approve, reason), "feed");
    },

    cancelJob(jobId) {
      return remote("jobs_cancel", { p_job: jobId }, (u) => cancelJob(u.email, jobId), "feed");
    },

    /* --- admin --- */
    adminQueue() {
      if (!serverReady()) return Promise.resolve(null);
      return call("wallet_admin_queue").catch((err) => { if (err.fellBack) return null; throw err; });
    },

    adminSettle(id, approve, note) {
      if (!serverReady()) return Promise.resolve().then(() => { settleRequest(id, approve); return null; });
      return call("wallet_admin_settle", { p_request: id, p_approve: !!approve, p_note: note || "" })
        .catch((err) => { if (err.fellBack) { settleRequest(id, approve); return null; } throw err; });
    },

    adminReviewSub(subId, approve, reason) {
      if (!serverReady()) return Promise.resolve().then(() => { reviewSub(subId, approve, reason); return null; });
      return call("jobs_admin_review", { p_sub: subId, p_approve: !!approve, p_reason: reason || "" })
        .catch((err) => { if (err.fellBack) { reviewSub(subId, approve, reason); return null; } throw err; });
    },

    adminCancelJob(jobId) {
      if (!serverReady()) return Promise.resolve().then(() => { adminCancelJob(jobId); return null; });
      return call("jobs_admin_cancel", { p_job: jobId })
        .catch((err) => { if (err.fellBack) { adminCancelJob(jobId); return null; } throw err; });
    },

    /* Cached payloads, for pages that want them without a round trip. */
    cached() { return { wallet: lastWallet, feed: lastFeed }; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    purgeDemoData();
    document.querySelectorAll("[data-usdt-icon]").forEach((el) => (el.innerHTML = USDT_SVG));
    syncWalletPills();
    /* In server mode the header chips must show the server balance, not the
       stale localStorage one. Harmless no-op when there is no session. */
    if (serverReady()) api.wallet().catch(() => {});
  });

  FF.W = {
    CFG, CATEGORIES, category, money, usd, uid,
    wallet, patchWallet, tx,
    createDeposit, createWithdraw, settleRequest, requests, myRequests,
    jobs, openJobs, myJobs, postJob, cancelJob,
    subs, jobSubs, mySubs, submitProof, reviewSub,
    adminCancelJob, adminSetJobStatus,
    convertPoints, syncWalletPills, purgeDemoData, USDT_SVG,
    api, serverReady,
  };
})();
