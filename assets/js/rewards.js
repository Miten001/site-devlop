/* =========================================================================
   FlexFam — Rewards Hub & Public Showcase Engine (window.FF.R)
   -------------------------------------------------------------------------
   Powers all 5 connected growth & engagement features:
     1. Weekly Leaderboard & Prize Pool (Top Earners / Taskers / Referrers)
     2. Lucky Spin / Daily Wheel (free daily + task bonus + 25-pt extra spin)
     3. Promo / Gift Codes (instant member redemption + history)
     4. VIP Membership Tiers (Bronze -> Diamond XP ladder, daily bonus, boost)
     5. Public Member Profile & Showcase Card (shareable + PNG download)

   Server mode uses Supabase RPCs from supabase-rewards-hub.sql (#28).
   Local / offline mode runs the exact same rules in browser storage so the
   site and automated tests work cleanly everywhere.
   ========================================================================= */
(function () {
  "use strict";

  const FF = (window.FF = window.FF || {});
  const VIP_KEY = "ff_vip_daily_v1";
  const SPIN_KEY = "ff_spin_logs_v1";
  const PROMO_STORE_KEY = "ff_promo_codes_v1";
  const PROMO_RED_KEY = "ff_promo_redemptions_v1";
  const LB_CLAIM_KEY = "ff_lb_claims_v1";

  const VIP_TIERS = [
    { id: "bronze",   name: "Bronze",   icon: "🥉", color: "#f59e0b", minXp: 0,    nextXp: 250,  nextName: "Silver",   freeSpins: 1, spinMult: 1.0,  dailyType: "points", dailyAmount: 10 },
    { id: "silver",   name: "Silver",   icon: "🥈", color: "#cbd5e1", minXp: 250,  nextXp: 750,  nextName: "Gold",     freeSpins: 1, spinMult: 1.1,  dailyType: "points", dailyAmount: 25 },
    { id: "gold",     name: "Gold",     icon: "🥇", color: "#ffd166", minXp: 750,  nextXp: 2000, nextName: "Platinum", freeSpins: 2, spinMult: 1.25, dailyType: "usdt",   dailyAmount: 0.02 },
    { id: "platinum", name: "Platinum", icon: "👑", color: "#a855f7", minXp: 2000, nextXp: 5000, nextName: "Diamond",  freeSpins: 2, spinMult: 1.5,  dailyType: "usdt",   dailyAmount: 0.05 },
    { id: "diamond",  name: "Diamond",  icon: "💎", color: "#38bdf8", minXp: 5000, nextXp: null, nextName: null,       freeSpins: 3, spinMult: 2.0,  dailyType: "usdt",   dailyAmount: 0.12 },
  ];

  const SPIN_SEGMENTS = [
    { id: "pts_10",  label: "+10 pts",       short: "10 pts",   type: "points", base: 10,   weight: 28, color: "#4f46e5" },
    { id: "pts_25",  label: "+25 pts",       short: "25 pts",   type: "points", base: 25,   weight: 22, color: "#0284c7" },
    { id: "pts_50",  label: "+50 pts",       short: "50 pts",   type: "points", base: 50,   weight: 15, color: "#7c3aed" },
    { id: "pts_100", label: "+100 pts",      short: "100 pts",  type: "points", base: 100,  weight: 8,  color: "#c026d3" },
    { id: "usdt_01", label: "$0.01 USDT",    short: "$0.01",    type: "usdt",   base: 0.01, weight: 12, color: "#059669" },
    { id: "usdt_02", label: "$0.02 USDT",    short: "$0.02",    type: "usdt",   base: 0.02, weight: 8,  color: "#0d9488" },
    { id: "usdt_05", label: "$0.05 USDT",    short: "$0.05",    type: "usdt",   base: 0.05, weight: 5,  color: "#d97706" },
    { id: "jackpot", label: "$0.15 JACKPOT", short: "JACKPOT",  type: "usdt",   base: 0.15, weight: 2,  color: "#e11d48" },
  ];

  const BADGE_META = {
    badge_starter:    { id: "badge_starter",    name: "Starter Spark",     icon: "⚡", color: "#34e5a5", rarity: "Common" },
    badge_hunter:     { id: "badge_hunter",     name: "Task Hunter",       icon: "🎯", color: "#38bdf8", rarity: "Rare" },
    badge_legend:     { id: "badge_legend",     name: "Task Legend",       icon: "🏆", color: "#ffd166", rarity: "Legendary" },
    badge_streak7:    { id: "badge_streak7",    name: "Week Warrior",      icon: "🔥", color: "#ff8a3d", rarity: "Uncommon" },
    badge_streak30:   { id: "badge_streak30",   name: "Streak Master",     icon: "👑", color: "#f43f5e", rarity: "Legendary" },
    badge_builder:    { id: "badge_builder",    name: "Community Builder", icon: "🤝", color: "#a855f7", rarity: "Rare" },
    badge_ambassador: { id: "badge_ambassador", name: "Fam Ambassador",    icon: "🌟", color: "#ec4899", rarity: "Legendary" },
    badge_creator:    { id: "badge_creator",    name: "Creator Launch",    icon: "📣", color: "#e0489f", rarity: "Uncommon" },
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[m]));
  }

  function utcTodayKey(nowMs) {
    return new Date(nowMs == null ? Date.now() : nowMs).toISOString().slice(0, 10);
  }

  function utcNextResetMs(nowMs) {
    const d = new Date(nowMs == null ? Date.now() : nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  }

  function isoWeekBounds(nowMs) {
    const d = new Date(nowMs == null ? Date.now() : nowMs);
    const day = d.getUTCDay() || 7; // Mon=1 .. Sun=7
    const monMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1), 0, 0, 0, 0);
    const nextMonMs = monMs + 7 * 86400000;
    const prevMonMs = monMs - 7 * 86400000;
    function keyFor(ms) {
      const t = new Date(ms);
      const thu = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 3));
      const yearStart = Date.UTC(thu.getUTCFullYear(), 0, 1);
      const weekNo = Math.ceil((((thu - yearStart) / 86400000) + 1) / 7);
      return thu.getUTCFullYear() + "-W" + String(weekNo).padStart(2, "0");
    }
    return { weekStart: monMs, weekEnd: nextMonMs, weekKey: keyFor(monMs), prevStart: prevMonMs, prevKey: keyFor(prevMonMs) };
  }

  function formatCountdown(targetMs, nowMs) {
    const diff = Math.max(0, Number(targetMs || 0) - (nowMs == null ? Date.now() : nowMs));
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return d > 0 ? d + "d " + pad(h) + "h " + pad(m) + "m" : pad(h) + "h " + pad(m) + "m " + pad(s) + "s";
  }

  function formatReward(type, amount) {
    const n = Number(amount) || 0;
    if (type === "usdt") {
      const dec = n < 0.01 ? 4 : (Math.round(n * 1000) % 10 !== 0 ? 3 : 2);
      return "+$" + n.toFixed(dec) + " USDT";
    }
    return "+" + Math.round(n).toLocaleString("en-IN") + " pts";
  }

  function tierForXp(xp) {
    const n = Math.max(0, Number(xp) || 0);
    let cur = VIP_TIERS[0];
    for (let i = 0; i < VIP_TIERS.length; i++) {
      if (n >= VIP_TIERS[i].minXp) cur = VIP_TIERS[i];
    }
    return Object.assign({ tierIndex: VIP_TIERS.indexOf(cur) }, cur);
  }

  function storeGet(key, fallback) {
    if (FF.store && FF.store.get) return FF.store.get(key, fallback);
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  function storeSet(key, val) {
    if (FF.store && FF.store.set) { FF.store.set(key, val); return; }
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  function isRpcMissing(err) {
    const msg = String((err && err.message) || err || "");
    return /does not exist|PGRST202|42883|Could not find the function|schema cache/i.test(msg);
  }

  function creditLocal(email, type, amount, note, txType) {
    if (type === "usdt" && FF.W && FF.W.patchWallet) {
      const add = Math.round((Number(amount) || 0) * 10000) / 10000;
      FF.W.patchWallet(email, (acc) => {
        acc.available = Math.round((Number(acc.available || 0) + add) * 10000) / 10000;
        acc.totalEarned = Math.round((Number(acc.totalEarned || 0) + add) * 10000) / 10000;
      });
      if (FF.W.tx) FF.W.tx(email, txType || "reward", add, note || "Reward", "completed");
      if (FF.W.syncWalletPills) FF.W.syncWalletPills();
    } else if (type === "usdt") {
      const all = storeGet("ff_wallets", {});
      const w = all[email] || { available: 0, locked: 0, totalEarned: 0, totalDeposited: 0, totalWithdrawn: 0, txns: [] };
      const add = Math.round((Number(amount) || 0) * 10000) / 10000;
      w.available = Math.round((Number(w.available || 0) + add) * 10000) / 10000;
      w.totalEarned = Math.round((Number(w.totalEarned || 0) + add) * 10000) / 10000;
      w.txns = w.txns || [];
      w.txns.unshift({ id: "r_" + Date.now(), type: txType || "reward", amount: add, note: note || "Reward", status: "completed", at: Date.now() });
      all[email] = w;
      storeSet("ff_wallets", all);
    } else if (type === "points") {
      const add = Math.max(0, Math.round(Number(amount) || 0));
      if (FF.awardCredits) {
        FF.awardCredits(email, add, note || "Reward");
      } else {
        const users = storeGet("ff_users", []);
        const u = users.find((x) => (x.email || "").toLowerCase() === String(email || "").toLowerCase());
        if (u) { u.credits = Math.round(Number(u.credits || 0) + add); storeSet("ff_users", users); }
      }
      if (FF.syncCreditPills) FF.syncCreditPills();
      if (FF.W && FF.W.syncWalletPills) FF.W.syncWalletPills();
    }
  }

  function spendLocalPoints(email, cost) {
    const users = storeGet("ff_users", []);
    const u = users.find((x) => (x.email || "").toLowerCase() === String(email || "").toLowerCase());
    if (!u || Number(u.credits || 0) < cost) throw new Error("You need " + cost + " points for an extra spin.");
    u.credits = Math.max(0, Math.round(Number(u.credits || 0) - cost));
    storeSet("ff_users", users);
    if (FF.W && FF.W.syncPills) FF.W.syncPills();
  }

  function localBreakdown(email) {
    const m = (FF.Q && FF.Q.computeLocalMetrics) ? FF.Q.computeLocalMetrics(email) : {
      todayCampaigns: 0, todayJobs: 0, totalTasks: 0, bestStreak: 0, referrals: 0, createdCount: 0, todayMining: 0
    };
    const users = storeGet("ff_users", []);
    const uRow = users.find((x) => (x.email || "").toLowerCase() === String(email || "").toLowerCase());
    const refs = Math.max(Number(m.referrals || 0), Number((uRow && uRow.referrals) || 0));
    const qAll = storeGet("ff_quest_claims", {});
    const qMine = qAll[String(email || "").trim().toLowerCase()] || [];
    const questClaims = Array.isArray(qMine) ? qMine.length : 0;
    const miningClaims = Number(m.todayMining || 0);
    return {
      totalTasks: Number(m.totalTasks || 0),
      todayTasks: Number(m.todayCampaigns || 0) + Number(m.todayJobs || 0),
      currentStreak: Number(m.bestStreak || 0),
      bestStreak: Number(m.bestStreak || 0),
      referrals: refs,
      miningClaims,
      questClaims,
      createdCount: Number(m.createdCount || 0),
    };
  }

  function localVipState(email, nowMs) {
    const bd = localBreakdown(email);
    const xp = bd.totalTasks * 20 + bd.bestStreak * 15 + bd.referrals * 40 + bd.miningClaims * 10 + bd.questClaims * 25;
    const t = tierForXp(xp);
    const today = utcTodayKey(nowMs);
    const all = storeGet(VIP_KEY, {});
    const mine = all[email] || [];
    const claimedToday = mine.some((c) => c.claimDay === today);
    return {
      mode: "local",
      tierId: t.id, tierName: t.name, tierIcon: t.icon, tierColor: t.color, tierIndex: t.tierIndex,
      xp, minXp: t.minXp, nextXp: t.nextXp, nextName: t.nextName,
      freeSpins: t.freeSpins, spinMult: t.spinMult, dailyType: t.dailyType, dailyAmount: t.dailyAmount,
      breakdown: bd,
      todayKey: today,
      utcResetAt: utcNextResetMs(nowMs),
      claimedToday,
      recentClaims: mine.slice(0, 10),
    };
  }

  function localVipClaim(email, nowMs) {
    const st = localVipState(email, nowMs);
    if (st.claimedToday) throw new Error("You already claimed today's VIP bonus — come back after midnight UTC.");
    const all = storeGet(VIP_KEY, {});
    const mine = all[email] || [];
    const rec = {
      claimDay: st.todayKey, tierId: st.tierId, tierName: st.tierName,
      rewardType: st.dailyType, rewardAmount: st.dailyAmount, claimedAt: nowMs == null ? Date.now() : nowMs,
    };
    mine.unshift(rec);
    all[email] = mine.slice(0, 30);
    storeSet(VIP_KEY, all);
    creditLocal(email, st.dailyType, st.dailyAmount, "VIP " + st.tierName + " daily bonus", "vip_bonus");
    return { claimed: rec, state: localVipState(email, nowMs) };
  }

  function localSpinState(email, nowMs) {
    const vip = localVipState(email, nowMs);
    const today = utcTodayKey(nowMs);
    const all = storeGet(SPIN_KEY, {});
    const mine = all[email] || [];
    const todaySpins = mine.filter((s) => s.spinDay === today);
    const freeUsed = todaySpins.filter((s) => !s.paid).length;
    const paidUsed = todaySpins.filter((s) => s.paid).length;
    const taskBonusUnlocked = vip.breakdown.todayTasks >= 1;
    const freeTotal = vip.freeSpins + (taskBonusUnlocked ? 1 : 0);
    const u = FF.currentUser ? FF.currentUser() : null;
    return {
      mode: "local",
      todayKey: today,
      utcResetAt: utcNextResetMs(nowMs),
      vipTier: vip.tierId, vipName: vip.tierName, vipIcon: vip.tierIcon,
      spinMult: vip.spinMult,
      baseFreeSpins: vip.freeSpins,
      taskBonusUnlocked,
      freeTotal,
      freeUsed,
      freeLeft: Math.max(0, freeTotal - freeUsed),
      paidUsed,
      paidMax: 2,
      paidLeft: Math.max(0, 2 - paidUsed),
      paidCostPts: 25,
      points: Number((u && u.credits) || 0),
      history: mine.slice(0, 15),
    };
  }

  function localSpinPlay(email, usePoints, nowMs) {
    const st = localSpinState(email, nowMs);
    const paid = !!usePoints;
    if (!paid) {
      if (st.freeLeft <= 0) throw new Error("No free spins left today — complete a task or use 25 points for an extra spin.");
    } else {
      if (st.paidLeft <= 0) throw new Error("Daily extra spin limit (2) reached — come back after midnight UTC.");
      spendLocalPoints(email, 25);
    }
    let roll = Math.random() * 100;
    let segIndex = 0;
    for (let i = 0; i < SPIN_SEGMENTS.length; i++) {
      roll -= SPIN_SEGMENTS[i].weight;
      if (roll <= 0) { segIndex = i; break; }
    }
    const seg = SPIN_SEGMENTS[segIndex];
    const mult = Number(st.spinMult || 1);
    const rewardAmount = seg.type === "points"
      ? Math.max(1, Math.round(seg.base * mult))
      : Math.round(seg.base * mult * 10000) / 10000;
    creditLocal(email, seg.type, rewardAmount, "Lucky Spin win: " + seg.label, "lucky_spin");
    const rec = {
      id: Date.now(), spinDay: st.todayKey, segmentIndex: segIndex, segmentId: seg.id, label: seg.label,
      paid, rewardType: seg.type, baseAmount: seg.base, multiplier: mult, rewardAmount,
      spunAt: nowMs == null ? Date.now() : nowMs,
    };
    const all = storeGet(SPIN_KEY, {});
    const mine = all[email] || [];
    mine.unshift(rec);
    all[email] = mine.slice(0, 40);
    storeSet(SPIN_KEY, all);
    return { spin: rec, state: localSpinState(email, nowMs) };
  }

  function ensureLocalPromos() {
    let list = storeGet(PROMO_STORE_KEY, null);
    if (!Array.isArray(list) || !list.length) {
      list = [
        { id: "p_welcome", code: "FLEXWELCOME", title: "Welcome gift code", rewardType: "points", rewardAmount: 50, maxUses: 500, usedCount: 0, active: true, expiresAt: null, createdAt: Date.now() },
      ];
      storeSet(PROMO_STORE_KEY, list);
    }
    return list;
  }

  function localPromoHistory(email) {
    const all = storeGet(PROMO_RED_KEY, {});
    return { mode: "local", items: (all[email] || []).slice(0, 25) };
  }

  function localPromoRedeem(email, rawCode, nowMs) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (code.length < 3) throw new Error("Enter a valid gift code.");
    const list = ensureLocalPromos();
    const row = list.find((p) => String(p.code || "").toUpperCase() === code);
    if (!row) throw new Error('Gift code "' + code + '" was not found. Check the spelling and try again.');
    if (!row.active) throw new Error('Gift code "' + row.code + '" is currently paused.');
    const now = nowMs == null ? Date.now() : nowMs;
    if (row.expiresAt && Number(row.expiresAt) <= now) throw new Error('Gift code "' + row.code + '" has expired.');
    if (row.maxUses > 0 && row.usedCount >= row.maxUses) throw new Error('Gift code "' + row.code + '" has reached its redemption limit.');
    const redAll = storeGet(PROMO_RED_KEY, {});
    const mine = redAll[email] || [];
    if (mine.some((r) => String(r.code || "").toUpperCase() === row.code)) {
      throw new Error('You have already redeemed gift code "' + row.code + '".');
    }
    row.usedCount = Number(row.usedCount || 0) + 1;
    storeSet(PROMO_STORE_KEY, list);
    const rec = { code: row.code, title: row.title, rewardType: row.rewardType, rewardAmount: row.rewardAmount, redeemedAt: now };
    mine.unshift(rec);
    redAll[email] = mine.slice(0, 40);
    storeSet(PROMO_RED_KEY, redAll);
    creditLocal(email, row.rewardType, row.rewardAmount, "Gift code redeemed: " + row.code, "promo");
    return { mode: "local", redeemed: rec, history: mine.slice(0, 25) };
  }

  function localProfileCodeFor(user) {
    if (user && user.refCode) return String(user.refCode).toUpperCase();
    const base = String((user && (user.id || user.email)) || "MEMBER").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return "FF-" + (base.slice(0, 8) || "FLEXFAM1");
  }

  function localLeaderboardState(email, category, nowMs) {
    const cat = ["earners", "taskers", "referrers"].includes(category) ? category : "earners";
    const wb = isoWeekBounds(nowMs);
    const users = storeGet("ff_users", []);
    const wallets = storeGet("ff_wallets", {});
    const rows = users.map((u) => {
      const em = u.email || "";
      const vip = localVipState(em, nowMs);
      let score = 0;
      if (cat === "taskers") {
        score = vip.breakdown.totalTasks;
      } else if (cat === "referrers") {
        score = vip.breakdown.referrals;
      } else {
        const w = wallets[em] || {};
        score = Math.round((Number(w.totalEarned || 0) + Number(u.credits || 0) * 0.0001) * 10000) / 10000;
      }
      return {
        email: em,
        displayName: u.name || em.split("@")[0] || "FlexFam Member",
        profileCode: localProfileCodeFor(u),
        score,
        isMe: em.toLowerCase() === String(email || "").toLowerCase(),
        vipTier: vip.tierId,
        vipIcon: vip.tierIcon,
      };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

    const entries = rows.slice(0, 20).map((r, i) => ({
      rank: i + 1, displayName: r.displayName, profileCode: r.profileCode,
      score: r.score, isMe: r.isMe, vipTier: r.vipTier, vipIcon: r.vipIcon,
    }));
    const meIdx = rows.findIndex((r) => r.isMe);
    const claims = storeGet(LB_CLAIM_KEY, {})[email] || [];
    const claimablePrizes = [];
    if (meIdx >= 0 && meIdx < 3) {
      const rank = meIdx + 1;
      const amt = rank === 1 ? 0.25 : (rank === 2 ? 0.10 : 0.05);
      claimablePrizes.push({
        category: cat, weekKey: wb.prevKey, rank, rewardType: "usdt", rewardAmount: amt,
        claimed: claims.some((c) => c.weekKey === wb.prevKey && c.category === cat),
      });
    }
    return {
      mode: "local",
      category: cat,
      weekKey: wb.weekKey,
      prevWeekKey: wb.prevKey,
      weekResetAt: wb.weekEnd,
      entries,
      myRank: meIdx >= 0 ? meIdx + 1 : null,
      myScore: meIdx >= 0 ? rows[meIdx].score : 0,
      claimablePrizes,
      prizePool: [
        { rank: 1, rewardType: "usdt", rewardAmount: 0.25 },
        { rank: 2, rewardType: "usdt", rewardAmount: 0.10 },
        { rank: 3, rewardType: "usdt", rewardAmount: 0.05 },
      ],
    };
  }

  function localLeaderboardClaim(email, category, weekKey, nowMs) {
    const st = localLeaderboardState(email, category, nowMs);
    const prize = (st.claimablePrizes || []).find((p) => p.category === category && p.weekKey === weekKey);
    if (!prize) throw new Error("No unclaimed weekly leaderboard prize found for " + weekKey + ".");
    if (prize.claimed) throw new Error("You already claimed your " + category + " leaderboard prize for " + weekKey + ".");
    const all = storeGet(LB_CLAIM_KEY, {});
    const mine = all[email] || [];
    mine.unshift({ category, weekKey, rank: prize.rank, rewardType: "usdt", rewardAmount: prize.rewardAmount, claimedAt: Date.now() });
    all[email] = mine;
    storeSet(LB_CLAIM_KEY, all);
    creditLocal(email, "usdt", prize.rewardAmount, "Weekly Leaderboard #" + prize.rank + " prize (" + category + ")", "leaderboard");
    return { claimed: prize, state: localLeaderboardState(email, category, nowMs) };
  }

  function localPublicProfile(code) {
    const users = storeGet("ff_users", []);
    const cur = FF.currentUser ? FF.currentUser() : null;
    const clean = String(code || "").trim().toUpperCase();
    let target = null;
    if (clean) {
      target = users.find((u) => localProfileCodeFor(u).toUpperCase() === clean);
    } else if (cur) {
      target = cur;
    }
    if (!target) return { mode: "local", found: false };
    const vip = localVipState(target.email);
    const bd = vip.breakdown;
    const badges = [];
    if (bd.totalTasks >= 5)   badges.push("badge_starter");
    if (bd.totalTasks >= 25)  badges.push("badge_hunter");
    if (bd.totalTasks >= 100) badges.push("badge_legend");
    if (bd.bestStreak >= 7)   badges.push("badge_streak7");
    if (bd.bestStreak >= 30)  badges.push("badge_streak30");
    if (bd.referrals >= 3)    badges.push("badge_builder");
    if (bd.referrals >= 1000) badges.push("badge_ambassador");
    if (bd.createdCount >= 1) badges.push("badge_creator");
    const rank = badges.length >= 8 ? "FlexFam Legend"
      : badges.length >= 5 ? "Elite Earner"
      : badges.length >= 3 ? "Task Specialist"
      : badges.length >= 1 ? "Rising Earner" : "Newcomer";
    return {
      mode: "local",
      found: true,
      isOwn: !!(cur && cur.email === target.email),
      displayName: target.name || (target.email || "Member").split("@")[0],
      code: localProfileCodeFor(target),
      joinedAt: Number(target.joinedAt || Date.now()),
      masteryRank: rank,
      vip,
      badges,
      stats: {
        totalTasks: bd.totalTasks, currentStreak: bd.currentStreak, bestStreak: bd.bestStreak,
        referrals: bd.referrals, createdCount: bd.createdCount, badgesUnlocked: badges.length, badgesTotal: 8,
      },
    };
  }

  function refreshWallet() {
    if (FF.W && FF.W.api && FF.W.api.wallet) FF.W.api.wallet().catch(() => {});
  }

  function fetchPublicRpc(fnName, body) {
    const cfg = window.FF_SUPABASE_CONFIG;
    if (!cfg || !cfg.url || !cfg.anonKey || /YOUR-PROJECT/i.test(cfg.url)) return Promise.resolve(null);
    let token = cfg.anonKey;
    try {
      const auth = JSON.parse(localStorage.getItem("ff_auth") || "null");
      if (auth && auth.access_token) token = auth.access_token;
    } catch {}
    return fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/rpc/" + fnName, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.anonKey,
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body || {}),
    }).then(async (res) => {
      const txt = await res.text();
      const data = txt ? JSON.parse(txt) : null;
      if (!res.ok) throw new Error((data && (data.message || data.error_description)) || ("HTTP " + res.status));
      return data;
    });
  }

  const api = {
    vipState() {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.resolve(null);
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("vip_state", {}).then((r) => Object.assign({ mode: "server" }, r))
          .catch((err) => {
            if (isRpcMissing(err)) return Object.assign(localVipState(u.email), { sqlMissing: true });
            throw err;
          });
      }
      return Promise.resolve(localVipState(u.email));
    },

    vipClaimDaily() {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.reject(new Error("Please sign in first."));
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("vip_claim_daily", {}).then((r) => {
          refreshWallet();
          return { claimed: r.claimed, state: Object.assign({ mode: "server" }, r.state || {}) };
        }).catch((err) => {
          if (isRpcMissing(err)) throw new Error("Rewards Hub is being activated on the server — please try again shortly.");
          throw err;
        });
      }
      return Promise.resolve().then(() => localVipClaim(u.email));
    },

    spinState() {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.resolve(null);
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("spin_state", {}).then((r) => Object.assign({ mode: "server" }, r))
          .catch((err) => {
            if (isRpcMissing(err)) return Object.assign(localSpinState(u.email), { sqlMissing: true });
            throw err;
          });
      }
      return Promise.resolve(localSpinState(u.email));
    },

    spinPlay(usePoints) {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.reject(new Error("Please sign in first."));
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("spin_play", { p_use_points: !!usePoints }).then((r) => {
          refreshWallet();
          return { spin: r.spin, state: Object.assign({ mode: "server" }, r.state || {}) };
        }).catch((err) => {
          if (isRpcMissing(err)) throw new Error("Lucky Spin is being activated on the server — please try again shortly.");
          throw err;
        });
      }
      return Promise.resolve().then(() => localSpinPlay(u.email, usePoints));
    },

    promoHistory() {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.resolve({ items: [] });
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("promo_history", {}).then((r) => Object.assign({ mode: "server" }, r))
          .catch((err) => {
            if (isRpcMissing(err)) return Object.assign(localPromoHistory(u.email), { sqlMissing: true });
            throw err;
          });
      }
      return Promise.resolve(localPromoHistory(u.email));
    },

    promoRedeem(code) {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.reject(new Error("Please sign in first."));
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("promo_redeem", { p_code: String(code || "").trim() }).then((r) => {
          refreshWallet();
          return Object.assign({ mode: "server" }, r);
        }).catch((err) => {
          if (isRpcMissing(err)) throw new Error("Gift codes are being activated on the server — please try again shortly.");
          throw err;
        });
      }
      return Promise.resolve().then(() => localPromoRedeem(u.email, code));
    },

    leaderboardState(category) {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.resolve(null);
      const cat = ["earners", "taskers", "referrers"].includes(category) ? category : "earners";
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("leaderboard_state", { p_category: cat }).then((r) => Object.assign({ mode: "server" }, r))
          .catch((err) => {
            if (isRpcMissing(err)) return Object.assign(localLeaderboardState(u.email, cat), { sqlMissing: true });
            throw err;
          });
      }
      return Promise.resolve(localLeaderboardState(u.email, cat));
    },

    leaderboardClaim(category, weekKey) {
      const u = FF.currentUser ? FF.currentUser() : null;
      if (!u) return Promise.reject(new Error("Please sign in first."));
      if (FF.hasServer && FF.hasServer() && FF.rpc) {
        return FF.rpc("leaderboard_claim", { p_category: category, p_week_key: weekKey }).then((r) => {
          refreshWallet();
          return { claimed: r.claimed, state: Object.assign({ mode: "server" }, r.state || {}) };
        }).catch((err) => {
          if (isRpcMissing(err)) throw new Error("Leaderboard claims are being activated on the server — please try again shortly.");
          throw err;
        });
      }
      return Promise.resolve().then(() => localLeaderboardClaim(u.email, category, weekKey));
    },

    publicProfile(code) {
      const clean = code ? String(code).trim() : null;
      const cfg = window.FF_SUPABASE_CONFIG;
      const hasCfg = !!(cfg && cfg.url && cfg.anonKey && !/YOUR-PROJECT/i.test(cfg.url));
      if (hasCfg && (clean || (FF.hasServer && FF.hasServer()))) {
        return fetchPublicRpc("public_profile_card", { p_code: clean })
          .then((r) => (r && r.found === true ? Object.assign({ mode: "server" }, r) : localPublicProfile(clean)))
          .catch(() => localPublicProfile(clean));
      }
      return Promise.resolve(localPublicProfile(clean));
    },
  };

  /* -----------------------------------------------------------------------
     Shared Dashboard & Wallet quick widgets
     ----------------------------------------------------------------------- */
  function injectQuickStyles() {
    if (document.getElementById("ff-rewards-quick-css")) return;
    const st = document.createElement("style");
    st.id = "ff-rewards-quick-css";
    st.textContent =
      ".vip-flair{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;" +
      "font-size:12px;font-weight:800;border:1px solid color-mix(in srgb,var(--vc,#ffd166) 55%,transparent);" +
      "background:color-mix(in srgb,var(--vc,#ffd166) 15%,transparent);color:var(--ink);text-decoration:none}" +
      ".vip-flair:hover{transform:translateY(-1px)}" +
      ".rh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}" +
      ".rh-tile{border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--glass-2);display:flex;flex-direction:column;gap:6px}" +
      ".rh-tile .t-top{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:var(--ink-mute);font-weight:700}" +
      ".rh-tile .t-val{font-family:'Sora',sans-serif;font-size:16px;font-weight:800;color:var(--ink)}" +
      ".rh-promo-row{display:flex;gap:8px;margin-top:10px}" +
      ".rh-promo-row input{flex:1;min-width:0;text-transform:uppercase;letter-spacing:.05em;font-weight:700}" +
      ".rh-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}" +
      "@media(max-width:600px){.rh-grid,.rh-links{grid-template-columns:1fr}}";
    document.head.appendChild(st);
  }

  function mountDashboardWidgets(panelEl, vipFlairEl) {
    injectQuickStyles();
    if (!panelEl) return;

    function paintFlair(vip) {
      if (!vipFlairEl || !vip) return;
      vipFlairEl.innerHTML =
        '<a href="rewards.html#vip" class="vip-flair" style="--vc:' + esc(vip.tierColor) + '" title="VIP Tier · ' + esc(vip.xp) + ' XP">' +
        '<span>' + esc(vip.tierIcon) + '</span><span>' + esc(vip.tierName) + ' VIP</span></a>';
    }

    function render(vip, spin) {
      paintFlair(vip);
      const freeLeft = Number((spin && spin.freeLeft) || 0);
      const dailyRew = vip ? formatReward(vip.dailyType, vip.dailyAmount) : "+10 pts";
      const vipClaimed = !!(vip && vip.claimedToday);
      panelEl.innerHTML =
        '<div class="panel-head">' +
          '<div><h3>Rewards Hub &amp; VIP perks</h3><p class="panel-sub">' +
            (vip ? esc(vip.tierIcon + " " + vip.tierName + " VIP · " + Number(vip.xp || 0).toLocaleString("en-IN") + " XP · " + vip.spinMult + "× spin boost") : "Lucky Spin, VIP bonuses, gift codes &amp; weekly leaderboard") +
          '</p></div>' +
          '<a href="rewards.html" class="status-pill on" style="text-decoration:none">Open Hub</a>' +
        '</div>' +
        '<div class="rh-grid">' +
          '<div class="rh-tile">' +
            '<div class="t-top"><span>🎡 Lucky Spin</span><span>' + (freeLeft > 0 ? '<b style="color:var(--mint)">Ready</b>' : 'Used today') + '</span></div>' +
            '<div class="t-val">' + (freeLeft > 0 ? freeLeft + ' free spin' + (freeLeft > 1 ? 's' : '') + ' left' : '0 free spins left') + '</div>' +
            '<a href="rewards.html#spin" class="btn btn-primary btn-sm" style="margin-top:auto">' + (freeLeft > 0 ? 'Spin Wheel →' : 'Open Wheel') + '</a>' +
          '</div>' +
          '<div class="rh-tile">' +
            '<div class="t-top"><span>' + esc((vip && vip.tierIcon) || '👑') + ' Daily VIP Bonus</span><span>' + esc(dailyRew) + '</span></div>' +
            '<div class="t-val">' + esc((vip && vip.tierName) || 'Bronze') + ' Tier</div>' +
            '<button type="button" class="btn ' + (vipClaimed ? 'btn-ghost' : 'btn-primary') + ' btn-sm" id="dash-vip-claim" style="margin-top:auto"' + (vipClaimed ? ' disabled' : '') + '>' +
              (vipClaimed ? '✓ Claimed today' : 'Claim ' + esc(dailyRew)) +
            '</button>' +
          '</div>' +
        '</div>' +
        '<form class="rh-promo-row" id="dash-promo-form" autocomplete="off">' +
          '<input type="text" id="dash-promo-in" placeholder="Enter gift code (e.g. FLEXWELCOME)" maxlength="32" aria-label="Gift code" />' +
          '<button type="submit" class="btn btn-primary btn-sm" id="dash-promo-btn">Redeem</button>' +
        '</form>' +
        '<div class="rh-links">' +
          '<a href="rewards.html#leaderboard" class="btn btn-ghost btn-sm">🏆 Weekly Leaderboard</a>' +
          '<a href="profile.html" class="btn btn-ghost btn-sm">🪪 My Showcase Card</a>' +
        '</div>';

      const vipBtn = panelEl.querySelector("#dash-vip-claim");
      if (vipBtn && !vipClaimed) {
        vipBtn.addEventListener("click", () => {
          vipBtn.disabled = true;
          vipBtn.textContent = "Claiming…";
          api.vipClaimDaily().then((res) => {
            if (FF.sfx && FF.sfx.coin) FF.sfx.coin();
            const c = res.claimed || {};
            FF.toast("VIP bonus claimed! " + formatReward(c.rewardType, c.rewardAmount) + " added", "ok");
            render(res.state, spin);
          }).catch((err) => {
            vipBtn.disabled = false;
            vipBtn.textContent = "Claim " + dailyRew;
            FF.toast((err && err.message) || "Could not claim VIP bonus", "err");
          });
        });
      }

      const pForm = panelEl.querySelector("#dash-promo-form");
      if (pForm) {
        pForm.addEventListener("submit", (e) => {
          e.preventDefault();
          const inp = panelEl.querySelector("#dash-promo-in");
          const btn = panelEl.querySelector("#dash-promo-btn");
          const code = (inp && inp.value || "").trim();
          if (!code) { FF.toast("Enter a gift code first", "err"); return; }
          btn.disabled = true;
          btn.textContent = "Checking…";
          api.promoRedeem(code).then((res) => {
            if (FF.sfx && FF.sfx.cash) FF.sfx.cash();
            const c = res.redeemed || {};
            FF.toast("Code " + (c.code || code.toUpperCase()) + " redeemed! " + formatReward(c.rewardType, c.rewardAmount) + " credited", "ok");
            inp.value = "";
            btn.disabled = false;
            btn.textContent = "Redeem";
          }).catch((err) => {
            btn.disabled = false;
            btn.textContent = "Redeem";
            FF.toast((err && err.message) || "Could not redeem code", "err");
          });
        });
      }
    }

    const loadAll = () => Promise.all([api.vipState(), api.spinState()])
      .then(([vip, spin]) => render(vip, spin))
      .catch(() => {});
    loadAll();
    document.addEventListener("ff:quests-refresh", loadAll);
  }

  function mountWalletPromoBar(hostEl) {
    if (!hostEl) return;
    injectQuickStyles();
    hostEl.innerHTML =
      '<div class="panel-head" style="margin-bottom:8px">' +
        '<div><h3>🎟️ Redeem a gift / promo code</h3><p class="panel-sub">Got a code from FlexFam announcements or Telegram? Redeem it below for instant Points or USDT.</p></div>' +
        '<a href="rewards.html#promo" class="btn btn-ghost btn-sm">History →</a>' +
      '</div>' +
      '<form class="rh-promo-row" id="wallet-promo-form" autocomplete="off">' +
        '<input type="text" id="wallet-promo-in" placeholder="Enter gift code (e.g. FLEXWELCOME)" maxlength="32" aria-label="Gift code" />' +
        '<button type="submit" class="btn btn-primary btn-sm" id="wallet-promo-btn">Redeem code</button>' +
      '</form>';
    const form = hostEl.querySelector("#wallet-promo-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = hostEl.querySelector("#wallet-promo-in");
      const btn = hostEl.querySelector("#wallet-promo-btn");
      const code = (inp.value || "").trim();
      if (!code) { FF.toast("Enter a gift code first", "err"); return; }
      btn.disabled = true;
      btn.textContent = "Redeeming…";
      api.promoRedeem(code).then((res) => {
        if (FF.sfx && FF.sfx.cash) FF.sfx.cash();
        const c = res.redeemed || {};
        FF.toast("Redeemed " + (c.code || code.toUpperCase()) + "! " + formatReward(c.rewardType, c.rewardAmount) + " added", "ok");
        inp.value = "";
        btn.disabled = false;
        btn.textContent = "Redeem code";
      }).catch((err) => {
        btn.disabled = false;
        btn.textContent = "Redeem code";
        FF.toast((err && err.message) || "Invalid gift code", "err");
      });
    });
  }

  /* -----------------------------------------------------------------------
     Client-side PNG Share Card renderer (1200 x 630) for profile.html
     ----------------------------------------------------------------------- */
  function renderShowcaseCanvas(card, canvas) {
    if (!canvas || !canvas.getContext || !card) return false;
    const W = 1200, H = 630;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0b0f1e");
    bg.addColorStop(0.55, "#151133");
    bg.addColorStop(1, "#0d1b2a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle neon glows
    const g1 = ctx.createRadialGradient(180, 120, 20, 180, 120, 420);
    g1.addColorStop(0, "rgba(224,72,159,0.28)");
    g1.addColorStop(1, "rgba(224,72,159,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(1020, 520, 20, 1020, 520, 420);
    g2.addColorStop(0, "rgba(56,189,248,0.24)");
    g2.addColorStop(1, "rgba(56,189,248,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    // Outer frame
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, W - 72, H - 72);

    // Brand
    ctx.fillStyle = "#34e5a5";
    ctx.font = "700 24px Inter, sans-serif";
    ctx.fillText("FLEXFAM · VERIFIED MEMBER CARD", 76, 102);

    // Member name
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 58px Sora, Inter, sans-serif";
    ctx.fillText(String(card.displayName || "FlexFam Member").slice(0, 24), 76, 192);

    // VIP & Rank line
    const vip = card.vip || {};
    ctx.fillStyle = vip.tierColor || "#ffd166";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText((vip.tierIcon || "🥉") + " " + (vip.tierName || "Bronze") + " VIP  ·  " + (card.masteryRank || "Newcomer") + "  ·  " + Number(vip.xp || 0).toLocaleString("en-IN") + " XP", 76, 246);

    // 4 stat boxes
    const stats = card.stats || {};
    const boxes = [
      { lbl: "TASKS COMPLETED", val: String(stats.totalTasks || 0) },
      { lbl: "BEST STREAK",     val: String(stats.bestStreak || 0) + " days" },
      { lbl: "REFERRALS",       val: String(stats.referrals || 0) },
      { lbl: "BADGES",          val: String(stats.badgesUnlocked || 0) + " / " + String(stats.badgesTotal || 8) },
    ];
    boxes.forEach((b, i) => {
      const bx = 76 + i * 268;
      const by = 300;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(bx, by, 246, 134);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.strokeRect(bx, by, 246, 134);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 16px Inter, sans-serif";
      ctx.fillText(b.lbl, bx + 22, by + 42);
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 38px Sora, Inter, sans-serif";
      ctx.fillText(b.val, bx + 22, by + 100);
    });

    // Invite CTA footer
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "600 24px Inter, sans-serif";
    ctx.fillText("Join FlexFam & earn Points + USDT with invite code:", 76, 515);
    ctx.fillStyle = "#ffd166";
    ctx.font = "800 38px Sora, Inter, sans-serif";
    ctx.fillText(String(card.code || "FLEXFAM"), 76, 565);

    return true;
  }

  FF.R = {
    VIP_TIERS,
    SPIN_SEGMENTS,
    BADGE_META,
    utcTodayKey,
    utcNextResetMs,
    isoWeekBounds,
    formatCountdown,
    formatReward,
    tierForXp,
    api,
    mountDashboardWidgets,
    mountWalletPromoBar,
    renderShowcaseCanvas,
  };
})();
