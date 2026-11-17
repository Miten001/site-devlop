/* ============================================================
   FlexFam — Daily Quests & Profile Badges Engine
   Server-authoritative when Supabase (#27 supabase-quests-badges.sql)
   is live; falls back cleanly to local simulation in demo/offline mode.
   ============================================================ */
(function () {
  if (!window.FF) return;
  const FF = window.FF;
  const store = FF.store;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]
  ));

  function sameEmail(a, b) {
    return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  }

  function utcTodayKey(nowMs) {
    return new Date(nowMs || Date.now()).toISOString().slice(0, 10);
  }

  function utcDayStartMs(nowMs) {
    const d = new Date(nowMs || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function utcNextResetMs(nowMs) {
    return utcDayStartMs(nowMs) + 24 * 3600 * 1000;
  }

  function formatCountdown(resetAtMs, nowMs) {
    const diff = Math.max(0, Math.floor((Number(resetAtMs || utcNextResetMs()) - (nowMs || Date.now())) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    return pad(h) + "h " + pad(m) + "m " + pad(s) + "s";
  }

  function formatReward(type, amount) {
    const n = Number(amount || 0);
    if (type === "usdt") return "+$" + n.toFixed(2) + " USDT";
    return "+" + Math.round(n).toLocaleString("en-US") + " pts";
  }

  const QUESTS = [
    /* --- Daily quests (reset 00:00 UTC) --- */
    {
      id: "daily_checkin",
      kind: "daily",
      title: "Daily Check-in",
      desc: "Claim your Daily Streak check-in today.",
      icon: "🔥",
      color: "#ff8a3d",
      metric: "todayCheckin",
      target: 1,
      rewardType: "points",
      rewardAmount: 15,
      badgeId: null,
      actionLabel: "Check in",
      actionHref: "dashboard.html#streak-panel",
    },
    {
      id: "daily_campaigns_3",
      kind: "daily",
      title: "Campaign Sprinter",
      desc: "Complete 3 Add Page campaigns today on Earn Points.",
      icon: "⚡",
      color: "#ffd166",
      metric: "todayCampaigns",
      target: 3,
      rewardType: "points",
      rewardAmount: 25,
      badgeId: null,
      actionLabel: "Earn Points",
      actionHref: "earn.html",
    },
    {
      id: "daily_campaigns_10",
      kind: "daily",
      title: "Campaign Pro",
      desc: "Complete 10 Add Page campaigns in a single day.",
      icon: "🚀",
      color: "#a855f7",
      metric: "todayCampaigns",
      target: 10,
      rewardType: "points",
      rewardAmount: 60,
      badgeId: null,
      actionLabel: "Earn Points",
      actionHref: "earn.html",
    },
    {
      id: "daily_jobs_1",
      kind: "daily",
      title: "Micro-Job Starter",
      desc: "Submit proof for 1 Task Market micro-job today.",
      icon: "✅",
      color: "#34e5a5",
      metric: "todayJobs",
      target: 1,
      rewardType: "usdt",
      rewardAmount: 0.01,
      badgeId: null,
      actionLabel: "Task Market",
      actionHref: "tasks.html",
    },
    {
      id: "daily_jobs_3",
      kind: "daily",
      title: "Micro-Job Grinder",
      desc: "Submit proof for 3 Task Market micro-jobs today.",
      icon: "💵",
      color: "#22d3ee",
      metric: "todayJobs",
      target: 3,
      rewardType: "usdt",
      rewardAmount: 0.03,
      badgeId: null,
      actionLabel: "Task Market",
      actionHref: "tasks.html",
    },
    {
      id: "daily_mining_claim",
      kind: "daily",
      title: "Daily Miner",
      desc: "Claim cloud mining earnings at least once today.",
      icon: "⛏️",
      color: "#38bdf8",
      metric: "todayMining",
      target: 1,
      rewardType: "points",
      rewardAmount: 20,
      badgeId: null,
      actionLabel: "Cloud Mining",
      actionHref: "mining.html",
    },

    /* --- Lifetime milestones & unlockable badges --- */
    {
      id: "mile_tasks_5",
      kind: "milestone",
      title: "First Steps",
      desc: "Reach 5 approved tasks across Earn Points and Task Market.",
      icon: "⚡",
      color: "#ffd166",
      metric: "totalTasks",
      target: 5,
      rewardType: "points",
      rewardAmount: 50,
      badgeId: "badge_starter",
      actionLabel: "Browse tasks",
      actionHref: "earn.html",
    },
    {
      id: "mile_tasks_25",
      kind: "milestone",
      title: "Task Hunter",
      desc: "Reach 25 approved tasks across Earn Points and Task Market.",
      icon: "🎯",
      color: "#34e5a5",
      metric: "totalTasks",
      target: 25,
      rewardType: "usdt",
      rewardAmount: 0.05,
      badgeId: "badge_hunter",
      actionLabel: "Browse tasks",
      actionHref: "tasks.html",
    },
    {
      id: "mile_tasks_100",
      kind: "milestone",
      title: "Task Legend",
      desc: "Reach 100 approved tasks across Earn Points and Task Market.",
      icon: "🏆",
      color: "#f59e0b",
      metric: "totalTasks",
      target: 100,
      rewardType: "usdt",
      rewardAmount: 0.25,
      badgeId: "badge_legend",
      actionLabel: "Browse tasks",
      actionHref: "tasks.html",
    },
    {
      id: "mile_streak_7",
      kind: "milestone",
      title: "Week Warrior",
      desc: "Reach a 7-day Daily Streak on your Dashboard.",
      icon: "🔥",
      color: "#ff8a3d",
      metric: "bestStreak",
      target: 7,
      rewardType: "usdt",
      rewardAmount: 0.05,
      badgeId: "badge_streak7",
      actionLabel: "View streak",
      actionHref: "dashboard.html#streak-panel",
    },
    {
      id: "mile_streak_30",
      kind: "milestone",
      title: "Streak Master",
      desc: "Reach a 30-day Daily Streak on your Dashboard.",
      icon: "👑",
      color: "#e0489f",
      metric: "bestStreak",
      target: 30,
      rewardType: "usdt",
      rewardAmount: 0.25,
      badgeId: "badge_streak30",
      actionLabel: "View streak",
      actionHref: "dashboard.html#streak-panel",
    },
    {
      id: "mile_refer_3",
      kind: "milestone",
      title: "Community Builder",
      desc: "Invite 3 friends who sign up with your referral link.",
      icon: "🤝",
      color: "#7c5cff",
      metric: "referrals",
      target: 3,
      rewardType: "points",
      rewardAmount: 150,
      badgeId: "badge_builder",
      actionLabel: "Invite friends",
      actionHref: "refer.html",
    },
    {
      id: "mile_refer_10",
      kind: "milestone",
      title: "Fam Ambassador",
      desc: "Invite 10 friends who sign up with your referral link.",
      icon: "🌟",
      color: "#ec4899",
      metric: "referrals",
      target: 10,
      rewardType: "usdt",
      rewardAmount: 0.30,
      badgeId: "badge_ambassador",
      actionLabel: "Invite friends",
      actionHref: "refer.html",
    },
    {
      id: "mile_creator_1",
      kind: "milestone",
      title: "Creator Launch",
      desc: "Launch your first campaign on Add Page or post a micro-job.",
      icon: "📣",
      color: "#22d3ee",
      metric: "createdCount",
      target: 1,
      rewardType: "points",
      rewardAmount: 40,
      badgeId: "badge_creator",
      actionLabel: "Add Page",
      actionHref: "add.html",
    },
  ];

  const BADGES = [
    { id: "badge_starter",    questId: "mile_tasks_5",   name: "Starter Spark",     icon: "⚡", rarity: "common",    color: "#ffd166", desc: "Completed 5 approved tasks" },
    { id: "badge_creator",    questId: "mile_creator_1", name: "Creator Launch",    icon: "📣", rarity: "common",    color: "#22d3ee", desc: "Launched a campaign or micro-job" },
    { id: "badge_hunter",     questId: "mile_tasks_25",  name: "Task Hunter",       icon: "🎯", rarity: "rare",      color: "#34e5a5", desc: "Completed 25 approved tasks" },
    { id: "badge_streak7",    questId: "mile_streak_7",  name: "Week Warrior",      icon: "🔥", rarity: "rare",      color: "#ff8a3d", desc: "Hit a 7-day check-in streak" },
    { id: "badge_builder",    questId: "mile_refer_3",   name: "Community Builder", icon: "🤝", rarity: "rare",      color: "#7c5cff", desc: "Invited 3 friends to FlexFam" },
    { id: "badge_legend",     questId: "mile_tasks_100", name: "Task Legend",       icon: "🏆", rarity: "epic",      color: "#f59e0b", desc: "Completed 100 approved tasks" },
    { id: "badge_streak30",   questId: "mile_streak_30", name: "Streak Master",     icon: "👑", rarity: "legendary", color: "#e0489f", desc: "Hit a 30-day check-in streak" },
    { id: "badge_ambassador", questId: "mile_refer_10",  name: "Fam Ambassador",    icon: "🌟", rarity: "legendary", color: "#ec4899", desc: "Invited 10 friends to FlexFam" },
  ];

  const LEVELS = [
    { min: 0, name: "Newcomer",        color: "#94a3b8" },
    { min: 1, name: "Rising Explorer", color: "#34e5a5" },
    { min: 3, name: "Task Specialist", color: "#22d3ee" },
    { min: 5, name: "FlexFam Veteran", color: "#a855f7" },
    { min: 8, name: "FlexFam Legend",  color: "#ffd166" },
  ];

  const QUEST_MAP = {};
  QUESTS.forEach((q) => { QUEST_MAP[q.id] = q; });
  const BADGE_MAP = {};
  BADGES.forEach((b) => { BADGE_MAP[b.id] = b; });

  function levelFor(unlockedCount) {
    const n = Math.max(0, Number(unlockedCount || 0));
    let cur = LEVELS[0];
    let next = null;
    for (let i = 0; i < LEVELS.length; i++) {
      if (n >= LEVELS[i].min) {
        cur = LEVELS[i];
        next = LEVELS[i + 1] || null;
      }
    }
    return {
      index: LEVELS.indexOf(cur) + 1,
      name: cur.name,
      color: cur.color,
      unlocked: n,
      total: BADGES.length,
      nextAt: next ? next.min : BADGES.length,
      nextName: next ? next.name : null,
    };
  }

  /* ---------- Pinned profile badge preference (per user) ---------- */
  function pinnedBadgeId(email) {
    if (!email) return "";
    const map = store.get("ff_quest_pinned", {});
    return String(map[String(email).trim().toLowerCase()] || "");
  }

  function setPinnedBadge(email, badgeId) {
    if (!email) return "";
    const key = String(email).trim().toLowerCase();
    const map = store.get("ff_quest_pinned", {});
    if (!badgeId) delete map[key];
    else map[key] = String(badgeId);
    store.set("ff_quest_pinned", map);
    return map[key] || "";
  }

  /* ---------- Local / browser mode claims & metrics ---------- */
  function localClaimsStore() {
    return store.get("ff_quest_claims", {});
  }

  function localUserClaims(email) {
    if (!email) return [];
    const all = localClaimsStore();
    return Array.isArray(all[String(email).trim().toLowerCase()]) ? all[String(email).trim().toLowerCase()] : [];
  }

  function saveLocalUserClaims(email, list) {
    const all = localClaimsStore();
    all[String(email).trim().toLowerCase()] = list;
    store.set("ff_quest_claims", all);
  }

  function computeLocalMetrics(email, nowMs) {
    const dayStart = utcDayStartMs(nowMs);
    const todayIso = utcTodayKey(nowMs);
    const campSubs = (FF.DB && FF.DB.campSubs ? FF.DB.campSubs() : []).filter((s) => sameEmail(s.worker, email));
    const doneList = (FF.DB && FF.DB.doneMap ? (FF.DB.doneMap()[email] || []) : []);
    const jobSubs = (FF.W && FF.W.subs ? FF.W.subs() : []).filter((s) => sameEmail(s.worker, email));

    const todayCampaigns = campSubs.filter((s) => (s.status === "approved" || s.status === "pending") && Number(s.at || 0) >= dayStart).length;
    const approvedCampIds = new Set(campSubs.filter((s) => s.status === "approved").map((s) => String(s.campaignId)));
    doneList.forEach((id) => approvedCampIds.add(String(id)));

    const todayJobs = jobSubs.filter((s) => (s.status === "approved" || s.status === "pending") && Number(s.at || 0) >= dayStart).length;
    const approvedJobs = jobSubs.filter((s) => s.status === "approved").length;

    const streakMap = store.get("ff_streak", {});
    const st = streakMap[email] || streakMap[String(email || "").trim().toLowerCase()] || {};
    const todayCheckin = (st.lastDate === todayIso || Number(st.lastClaimAt || 0) >= dayStart) ? 1 : 0;
    const bestStreak = Math.max(Number(st.best || 0), Number(st.streak || 0));

    const mineState = store.get("ff_mining", {})[email] || {};
    const mineLedger = Array.isArray(mineState.ledger) ? mineState.ledger : [];
    const todayMining = mineLedger.filter((r) => r.type === "claim" && Number(r.at || 0) >= dayStart).length;

    const u = FF.currentUser();
    const userObj = u && sameEmail(u.email, email) ? u : null;
    const myCamps = (FF.DB && FF.DB.campaigns ? FF.DB.campaigns() : []).filter((c) => sameEmail(c.authorEmail, email));
    const userCamps = userObj && Array.isArray(userObj.campaigns) ? userObj.campaigns : [];
    const myJobs = (FF.W && FF.W.myJobs ? FF.W.myJobs(email) : []);
    const createdIds = new Set();
    myCamps.forEach((c) => createdIds.add("c:" + c.id));
    userCamps.forEach((c) => createdIds.add("c:" + c.id));
    myJobs.forEach((j) => createdIds.add("j:" + j.id));

    const refStore = store.get("ff_referrals", {});
    const refArr = Array.isArray(refStore[email]) ? refStore[email]
      : (Array.isArray(refStore[String(email || "").trim().toLowerCase()]) ? refStore[String(email || "").trim().toLowerCase()] : []);
    const referrals = Math.max(refArr.length, Number(userObj && userObj.referrals || 0));

    return {
      todayCheckin,
      todayCampaigns,
      todayJobs,
      todayMining,
      totalTasks: approvedCampIds.size + approvedJobs,
      bestStreak,
      referrals,
      createdCount: createdIds.size,
    };
  }

  /* ---------- View assembly (identical shape in server & local modes) ---------- */
  function buildView(email, raw, mode, sqlMissing) {
    const todayKey = raw.todayKey || utcTodayKey();
    const utcResetAt = Number(raw.utcResetAt || utcNextResetMs());
    const metrics = raw.metrics || {};

    const srvQuestById = {};
    (raw.quests || []).forEach((q) => { srvQuestById[q.id] = q; });
    const srvBadgeById = {};
    (raw.badges || []).forEach((b) => { srvBadgeById[b.id] = b; });

    const quests = QUESTS.map((def) => {
      const s = srvQuestById[def.id] || {};
      const rawProg = s.rawProgress != null ? Number(s.rawProgress) : Number(metrics[def.metric] || 0);
      const target = Number(s.target || def.target);
      const progress = Math.min(Math.max(0, rawProg), target);
      const claimed = !!s.claimed;
      const claimable = !claimed && rawProg >= target;
      const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
      return Object.assign({}, def, {
        progress,
        rawProgress: rawProg,
        target,
        pct,
        periodKey: s.periodKey || (def.kind === "daily" ? todayKey : "lifetime"),
        claimed,
        claimedAt: s.claimedAt || null,
        claimable,
      });
    });

    const wantedPin = pinnedBadgeId(email);
    const badges = BADGES.map((def) => {
      const s = srvBadgeById[def.id] || {};
      const q = quests.find((x) => x.id === def.questId);
      const progress = s.progress != null ? Number(s.progress) : (q ? q.progress : 0);
      const target = s.target != null ? Number(s.target) : (q ? q.target : 1);
      const unlocked = s.unlocked != null ? !!s.unlocked : (progress >= target || !!(q && q.claimed));
      const claimed = s.claimed != null ? !!s.claimed : !!(q && q.claimed);
      return Object.assign({}, def, {
        progress,
        target,
        pct: target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0,
        unlocked,
        claimed,
        pinned: unlocked && wantedPin === def.id,
      });
    });

    let activePinned = badges.find((b) => b.pinned) || null;
    if (!activePinned) {
      const unlockedList = badges.filter((b) => b.unlocked);
      if (unlockedList.length) activePinned = unlockedList[unlockedList.length - 1];
    }

    const daily = quests.filter((q) => q.kind === "daily");
    const milestones = quests.filter((q) => q.kind === "milestone");
    const unlockedCount = badges.filter((b) => b.unlocked).length;
    const totals = raw.totals || {};

    return {
      mode: mode || "local",
      sqlMissing: !!sqlMissing,
      todayKey,
      utcResetAt,
      metrics,
      quests,
      badges,
      level: levelFor(unlockedCount),
      pinnedBadge: activePinned,
      summary: {
        claimableCount: quests.filter((q) => q.claimable).length,
        dailyDone: daily.filter((q) => q.claimed).length,
        dailyTotal: daily.length,
        milestonesDone: milestones.filter((q) => q.claimed).length,
        milestonesTotal: milestones.length,
        badgesUnlocked: unlockedCount,
        badgesTotal: badges.length,
        totalClaims: Number(totals.claims || 0),
        totalUsdt: Number(totals.usdt || 0),
        totalPoints: Number(totals.points || 0),
      },
    };
  }

  function localView(email, nowMs) {
    const todayKey = utcTodayKey(nowMs);
    const resetAt = utcNextResetMs(nowMs);
    const metrics = computeLocalMetrics(email, nowMs);
    const claims = localUserClaims(email);

    const claimLookup = {};
    let totalUsdt = 0;
    let totalPoints = 0;
    claims.forEach((c) => {
      claimLookup[c.questId + "::" + c.periodKey] = c;
      if (c.rewardType === "usdt") totalUsdt += Number(c.rewardAmount || 0);
      else totalPoints += Number(c.rewardAmount || 0);
    });

    const quests = QUESTS.map((def) => {
      const periodKey = def.kind === "daily" ? todayKey : "lifetime";
      const rec = claimLookup[def.id + "::" + periodKey];
      const rawProg = Number(metrics[def.metric] || 0);
      return {
        id: def.id,
        rawProgress: rawProg,
        progress: Math.min(rawProg, def.target),
        target: def.target,
        periodKey,
        claimed: !!rec,
        claimedAt: rec ? rec.claimedAt : null,
      };
    });

    const badges = BADGES.map((def) => {
      const q = QUEST_MAP[def.questId];
      const rec = claimLookup[def.questId + "::lifetime"];
      const rawProg = Number(metrics[q.metric] || 0);
      return {
        id: def.id,
        questId: def.questId,
        unlocked: rawProg >= q.target || !!rec,
        claimed: !!rec,
        progress: Math.min(rawProg, q.target),
        target: q.target,
      };
    });

    return buildView(email, {
      todayKey,
      utcResetAt: resetAt,
      metrics,
      quests,
      badges,
      totals: {
        claims: claims.length,
        usdt: Math.round(totalUsdt * 10000) / 10000,
        points: Math.round(totalPoints),
      },
    }, "local", false);
  }

  function localClaim(email, questId, nowMs) {
    const def = QUEST_MAP[String(questId || "").trim()];
    if (!def) throw new Error("Quest not found");
    const todayKey = utcTodayKey(nowMs);
    const periodKey = def.kind === "daily" ? todayKey : "lifetime";
    const claims = localUserClaims(email).slice();
    if (claims.some((c) => c.questId === def.id && c.periodKey === periodKey)) {
      throw new Error("You already claimed this quest reward");
    }
    const metrics = computeLocalMetrics(email, nowMs);
    const progress = Number(metrics[def.metric] || 0);
    if (progress < def.target) {
      throw new Error("Quest progress is " + progress + "/" + def.target + " — finish the goal before claiming");
    }

    const entry = {
      questId: def.id,
      periodKey,
      rewardType: def.rewardType,
      rewardAmount: def.rewardAmount,
      claimedAt: nowMs || Date.now(),
    };
    claims.unshift(entry);
    saveLocalUserClaims(email, claims);

    if (def.rewardType === "points") {
      if (FF.awardCredits) {
        FF.awardCredits(email, def.rewardAmount, "Quest reward: " + def.title);
      }
      if (FF.syncCreditPills) FF.syncCreditPills();
    } else if (FF.W && FF.W.patchWallet) {
      FF.W.patchWallet(email, (acc) => {
        acc.available = Math.round((Number(acc.available || 0) + def.rewardAmount) * 10000) / 10000;
        acc.totalEarned = Math.round((Number(acc.totalEarned || 0) + def.rewardAmount) * 10000) / 10000;
      });
      if (FF.W.tx) FF.W.tx(email, "quest", def.rewardAmount, "Quest reward: " + def.title, "completed");
      if (FF.W.syncWalletPills) FF.W.syncWalletPills();
    }

    return {
      claimed: {
        id: def.id,
        title: def.title,
        rewardType: def.rewardType,
        rewardAmount: def.rewardAmount,
        badgeId: def.badgeId,
      },
      state: localView(email, nowMs),
    };
  }

  function isMissingRpc(err) {
    const msg = String((err && err.message) || "");
    return /quests_(state|claim)|schema cache|could not find the function|PGRST202/i.test(msg);
  }

  let lastState = null;

  const api = {
    isServer() { return !!(FF.hasServer && FF.hasServer()); },

    state() {
      const u = FF.currentUser();
      if (!u || !u.email) return Promise.reject(new Error("Please log in"));
      if (!api.isServer()) {
        const v = localView(u.email);
        lastState = v;
        return Promise.resolve(v);
      }
      return FF.rpc("quests_state").then((payload) => {
        const v = buildView(u.email, payload || {}, "server", false);
        lastState = v;
        return v;
      }).catch((err) => {
        if (err && err.offline) {
          const v = localView(u.email);
          lastState = v;
          return v;
        }
        if (isMissingRpc(err)) {
          console.warn("[FlexFam] quests_state not live on server yet — run supabase-quests-badges.sql (#27) once in the Supabase SQL editor.");
          const fallback = localView(u.email);
          fallback.mode = "server";
          fallback.sqlMissing = true;
          lastState = fallback;
          return fallback;
        }
        throw err;
      });
    },

    claim(questId) {
      const u = FF.currentUser();
      if (!u || !u.email) return Promise.reject(new Error("Please log in"));
      if (!api.isServer()) {
        return Promise.resolve().then(() => {
          const res = localClaim(u.email, questId);
          lastState = res.state;
          return res;
        });
      }
      return FF.rpc("quests_claim", { p_quest_id: String(questId || "").trim() }).then((res) => {
        const v = buildView(u.email, (res && res.state) || {}, "server", false);
        lastState = v;
        if (FF.W && FF.W.api && FF.W.api.wallet) FF.W.api.wallet().catch(() => {});
        return { claimed: res && res.claimed, state: v };
      }).catch((err) => {
        if (err && err.offline) {
          const res = localClaim(u.email, questId);
          lastState = res.state;
          return res;
        }
        if (isMissingRpc(err)) {
          console.warn("[FlexFam] quests_claim not live on server yet — run supabase-quests-badges.sql (#27) once in the Supabase SQL editor.");
          const setup = new Error("Quests are being activated on the server — please try again shortly.");
          setup.code = "QUESTS_MIGRATION_REQUIRED";
          throw setup;
        }
        throw err;
      });
    },

    cached() { return lastState; },
  };

  /* ---------- Reusable Dashboard widget ---------- */
  function paintGreetingBadge(el, view) {
    if (!el) return;
    const b = view && view.pinnedBadge;
    if (!b) {
      el.innerHTML = "";
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = '<a href="quests.html#badges" class="qb-flair" style="--bc:' + esc(b.color) + '" title="' + esc(b.name + " — " + b.desc) + '">' +
      '<span>' + esc(b.icon) + '</span> ' + esc(b.name) + '</a>';
  }

  function mountDashboardWidget(hostEl, greetingBadgeEl) {
    if (!hostEl) return;
    const u = FF.currentUser();
    if (!u || !u.email) return;

    function render(view) {
      if (!view) return;
      paintGreetingBadge(greetingBadgeEl, view);

      const s = view.summary;
      const pill = s.claimableCount > 0
        ? '<span class="status-pill on">' + s.claimableCount + ' ready to claim</span>'
        : '<span class="status-pill off">' + s.dailyDone + '/' + s.dailyTotal + ' daily done</span>';

      /* Show up to 3 priority quests: claimable first, then unclaimed dailies with most progress. */
      const featured = view.quests.slice()
        .filter((q) => !q.claimed)
        .sort((a, b) => (b.claimable ? 1 : 0) - (a.claimable ? 1 : 0)
          || (a.kind === "daily" ? 0 : 1) - (b.kind === "daily" ? 0 : 1)
          || b.pct - a.pct)
        .slice(0, 3);

      const badgeRow = view.badges.map((b) => (
        '<span class="qb-mini-badge' + (b.unlocked ? " unlocked" : "") + '" style="--bc:' + esc(b.color) + '" title="' +
        esc(b.name + " · " + (b.unlocked ? "Unlocked" : b.progress + "/" + b.target)) + '">' + esc(b.icon) + '</span>'
      )).join("");

      const rows = featured.length
        ? featured.map((q) => (
            '<div class="qb-row">' +
              '<span class="qb-ico" style="--bc:' + esc(q.color) + '">' + esc(q.icon) + '</span>' +
              '<div class="qb-info">' +
                '<div class="qb-top"><b>' + esc(q.title) + '</b><span class="qb-rew ' + esc(q.rewardType) + '">' + esc(formatReward(q.rewardType, q.rewardAmount)) + '</span></div>' +
                '<div class="qb-bar"><i style="width:' + q.pct + '%;background:' + esc(q.color) + '"></i></div>' +
                '<div class="qb-meta"><span>' + q.progress + ' / ' + q.target + '</span><span>' + (q.kind === "daily" ? "Daily" : "Milestone") + '</span></div>' +
              '</div>' +
              (q.claimable
                ? '<button type="button" class="btn btn-primary btn-sm" data-dash-claim="' + esc(q.id) + '">Claim</button>'
                : '<a href="' + esc(q.actionHref) + '" class="btn btn-ghost btn-sm">Go</a>') +
            '</div>'
          )).join("")
        : '<div class="empty-mini" style="margin:6px 0"><b>All active quests claimed!</b>Check back at midnight UTC for fresh daily quests.</div>';

      hostEl.innerHTML =
        '<div class="panel-head">' +
          '<div><h3>Daily quests &amp; badges</h3><p class="panel-sub">' + esc(view.level.name) + ' · ' + s.badgesUnlocked + '/' + s.badgesTotal + ' badges unlocked</p></div>' +
          pill +
        '</div>' +
        '<div class="qb-badge-strip">' + badgeRow + '</div>' +
        '<div class="qb-list">' + rows + '</div>' +
        '<a href="quests.html" class="btn btn-ghost btn-sm btn-block" style="margin-top:10px">Open all quests &amp; badges →</a>';
    }

    hostEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dash-claim]");
      if (!btn || btn.disabled) return;
      const qid = btn.dataset.dashClaim;
      btn.disabled = true;
      btn.textContent = "Claiming…";
      api.claim(qid).then((res) => {
        if (FF.sfx && FF.sfx.coin) FF.sfx.coin();
        const c = res.claimed || {};
        FF.toast("Quest claimed! " + formatReward(c.rewardType, c.rewardAmount) + " credited", "ok");
        render(res.state);
      }).catch((err) => {
        btn.disabled = false;
        btn.textContent = "Claim";
        FF.toast((err && err.message) || "Could not claim quest", "err");
      });
    });

    const reload = () => api.state().then(render).catch(() => {});
    reload();
    document.addEventListener("ff:quests-refresh", reload);
    document.addEventListener("ff:campaigns-synced", reload);
  }

  FF.Q = {
    QUESTS,
    BADGES,
    LEVELS,
    QUEST_MAP,
    BADGE_MAP,
    levelFor,
    utcTodayKey,
    utcNextResetMs,
    formatCountdown,
    formatReward,
    pinnedBadgeId,
    setPinnedBadge,
    computeLocalMetrics,
    localView,
    localClaim,
    api,
    mountDashboardWidget,
  };
})();
