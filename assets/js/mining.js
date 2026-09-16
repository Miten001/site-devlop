/* ============================================================
   FLEXFAM — Cloud Mining engine
   Users rent hashrate with POINTS or USDT, the rig accrues rewards in
   real time (also while they are offline) and they claim the mined
   balance into the USDT wallet or back into points.

   Storage key: ff_mining  -> { [email]: MiningState }
   MiningState = {
     contracts: [ { id, plan, name, ghs, days, startedAt, endsAt,
                    paidAmount, paidWith, priceUsd, earned, status } ],
     unclaimed: Number (USDT), claimed: Number (USDT),
     lastAccrue: ms, boostUntil: ms, lastBoost: ms, log: [ ... ]
   }

   NOTE: like the rest of the wallet this is a front-end simulation of the
   money flow (localStorage). Real hashrate/payout settlement must be done
   by your backend or mining pool API.
   ============================================================ */
(function () {
  "use strict";

  if (!window.FF || !window.FF.W) return;
  const store = FF.store;
  const W = FF.W;

  const CFG = {
    /* Economics ---------------------------------------------------
       Rates are tuned so a contract returns roughly 1.15x - 1.5x of its
       price across the full term (longer contracts return a bit more).
       Change usdPerGhsDay to make mining faster or slower globally. */
    usdPerGhsDay: 0.000826,    // gross mining output per 1 GH/s per day
    maintenancePct: 8,         // electricity + pool fee, deducted from the gross rate

    /* custom rig builder: price of 1 GH/s for a 30 day term, with volume tiers */
    customTiers: [
      { upTo: 500, usdPerGhs: 0.020 },
      { upTo: 2000, usdPerGhs: 0.0185 },
      { upTo: Infinity, usdPerGhs: 0.017 },
    ],
    customMinGhs: 100,
    customMaxGhs: 20000,
    customDays: 30,

    minClaimUsdt: 0.05,        // minimum mined balance to claim
    pointsBonusPct: 10,        // extra % when claiming mined rewards as points
    boostPct: 25,              // free daily boost strength
    boostHours: 8,             // how long the boost lasts
    boostCooldownH: 24,        // one free boost per 24h
  };

  /* net rate after maintenance */
  function netRate() { return CFG.usdPerGhsDay * (1 - CFG.maintenancePct / 100); }
  function pointsPerUsdt() { return W.CFG.pointsPerUsdt || 1000; }

  /* ---------- plans ---------- */
  const PLANS = [
    {
      key: "free", name: "Free Starter Rig", tag: "FREE",
      ghs: 30, days: 7, priceUsd: 0, color: "#34e5a5", free: true,
      perks: ["No payment needed", "Renewable when it expires", "Mined rewards land in your wallet"],
    },
    {
      key: "bronze", name: "Bronze Miner", tag: "STARTER",
      ghs: 250, days: 30, priceUsd: 5, color: "#ff8a3d",
      perks: ["250 GH/s dedicated hashrate", "30 day contract", "Pay with points or USDT"],
    },
    {
      key: "silver", name: "Silver Rig", tag: "POPULAR",
      ghs: 550, days: 60, priceUsd: 20, color: "#22d3ee", featured: true,
      perks: ["10% cheaper per GH/s than Bronze", "60 day contract", "Daily boost stacks on top"],
    },
    {
      key: "gold", name: "Gold Farm", tag: "PRO",
      ghs: 975, days: 90, priceUsd: 50, color: "#ffd166",
      perks: ["Best mid-tier rate per GH/s", "90 day contract", "Priority payout queue"],
    },
    {
      key: "titan", name: "Titan Data Center", tag: "WHALE",
      ghs: 1700, days: 180, priceUsd: 150, color: "#a970ff",
      perks: ["Lowest rate per GH/s on the pool", "180 day contract", "Highest lifetime output"],
    },
  ];

  function plan(key) { return PLANS.find((p) => p.key === key) || null; }

  /* points price of a plan / of any USD amount */
  function pointsPrice(usd) { return Math.ceil(Number(usd || 0) * pointsPerUsdt()); }

  /* projected output helpers */
  function dailyUsd(ghs) { return ghs * netRate(); }
  function totalUsd(ghs, days) { return dailyUsd(ghs) * days; }
  function roi(p) { return p.priceUsd > 0 ? totalUsd(p.ghs, p.days) / p.priceUsd : 0; }

  /* ---------- state ---------- */
  function all() { return store.get("ff_mining", {}); }
  function saveAll(m) { store.set("ff_mining", m); }

  function blank() {
    return { contracts: [], unclaimed: 0, claimed: 0, lastAccrue: Date.now(), boostUntil: 0, lastBoost: 0, log: [] };
  }

  function raw(email) {
    const m = all();
    if (!m[email]) { m[email] = blank(); saveAll(m); }
    return m[email];
  }

  function patch(email, fn) {
    const m = all();
    if (!m[email]) m[email] = blank();
    fn(m[email]);
    saveAll(m);
    return m[email];
  }

  function log(email, type, text, amount) {
    patch(email, (s) => {
      s.log = s.log || [];
      s.log.unshift({ id: W.uid("mlg"), type, text, amount: Number(amount || 0), at: Date.now() });
      s.log = s.log.slice(0, 120);
    });
  }

  /* ---------- accrual ---------- */
  /* Mining runs on wall-clock time, so rewards keep piling up while the
     user is offline. Every read of the state accrues first. */
  function accrue(email) {
    const now = Date.now();
    return patch(email, (s) => {
      const last = Math.min(s.lastAccrue || now, now);
      let gained = 0;
      (s.contracts || []).forEach((c) => {
        if (c.status !== "active") return;
        const from = Math.max(last, c.startedAt);
        const to = Math.min(now, c.endsAt);
        if (to > from) {
          const perMs = (c.ghs * netRate()) / 86400000;
          let amt = (to - from) * perMs;
          const bTo = Math.min(to, s.boostUntil || 0);
          if (bTo > from) amt += (bTo - from) * perMs * (CFG.boostPct / 100);
          c.earned = round(c.earned + amt);
          gained += amt;
        }
        if (now >= c.endsAt) c.status = "expired";
      });
      if (gained > 0) s.unclaimed = round(s.unclaimed + gained);
      s.lastAccrue = now;
    });
  }

  function round(n) { return Math.round(Number(n || 0) * 1e6) / 1e6; }

  function state(email) { return accrue(email); }

  function activeContracts(email) {
    return state(email).contracts.filter((c) => c.status === "active" && Date.now() < c.endsAt);
  }

  function hashrate(email) {
    return activeContracts(email).reduce((n, c) => n + c.ghs, 0);
  }

  function boostActive(email) { return (state(email).boostUntil || 0) > Date.now(); }

  function stats(email) {
    const s = state(email);
    const ghs = hashrate(email);
    const boosted = boostActive(email);
    const perDay = dailyUsd(ghs) * (boosted ? 1 + CFG.boostPct / 100 : 1);
    return {
      ghs, perDay, perHour: perDay / 24, perSecond: perDay / 86400,
      unclaimed: s.unclaimed, claimed: s.claimed,
      lifetime: round(s.claimed + s.unclaimed),
      active: activeContracts(email).length,
      boosted, boostUntil: s.boostUntil || 0,
      invested: s.contracts.reduce((n, c) => n + (c.priceUsd || 0), 0),
    };
  }

  /* ---------- buying hashrate ---------- */
  /* currency: "usdt" | "points" */
  function charge(email, priceUsd, currency, label) {
    if (priceUsd <= 0) return { paidWith: "free", paidAmount: 0 };
    if (currency === "points") {
      const pts = pointsPrice(priceUsd);
      const user = FF.currentUser();
      if (!user || (user.credits || 0) < pts) {
        throw new Error("Need " + pts.toLocaleString("en-IN") + " points — you have " + Number((user && user.credits) || 0).toLocaleString("en-IN"));
      }
      FF.spendCredits(email, pts, label);
      return { paidWith: "points", paidAmount: pts };
    }
    const w = W.wallet(email);
    if (w.available < priceUsd) throw new Error("Need " + W.usd(priceUsd) + " USDT in your wallet — deposit or convert points first");
    W.patchWallet(email, (acc) => { acc.available = round(acc.available - priceUsd); });
    W.tx(email, "mining", -priceUsd, label, "completed");
    return { paidWith: "usdt", paidAmount: priceUsd };
  }

  function addContract(email, data) {
    const now = Date.now();
    const c = {
      id: W.uid("mine"), plan: data.plan, name: data.name,
      ghs: Number(data.ghs), days: Number(data.days),
      startedAt: now, endsAt: now + Number(data.days) * 86400000,
      priceUsd: Number(data.priceUsd || 0), paidWith: data.paidWith, paidAmount: data.paidAmount,
      earned: 0, status: "active",
    };
    patch(email, (s) => { s.contracts.unshift(c); });
    return c;
  }

  function buyPlan(email, key, currency) {
    accrue(email);
    const p = plan(key);
    if (!p) throw new Error("Unknown mining plan");

    if (p.free) {
      const running = state(email).contracts.some((c) => c.plan === "free" && c.status === "active" && Date.now() < c.endsAt);
      if (running) throw new Error("Your free starter rig is already running — renew it when it expires");
    }

    const paid = charge(email, p.priceUsd, currency, "Hashrate purchase — " + p.name + " (" + fmtHash(p.ghs) + ")");
    const c = addContract(email, {
      plan: p.key, name: p.name, ghs: p.ghs, days: p.days, priceUsd: p.priceUsd,
      paidWith: paid.paidWith, paidAmount: paid.paidAmount,
    });
    log(email, "buy", "Started " + p.name + " · " + fmtHash(p.ghs) + " for " + p.days + " days", -p.priceUsd);
    return c;
  }

  function customRate(ghs) {
    const tier = CFG.customTiers.find((t) => Number(ghs) <= t.upTo) || CFG.customTiers[CFG.customTiers.length - 1];
    return tier.usdPerGhs;
  }

  function customPrice(ghs, days) {
    days = Number(days || CFG.customDays);
    return Math.round(Number(ghs) * customRate(ghs) * (days / CFG.customDays) * 100) / 100;
  }

  function buyCustom(email, ghs, days, currency) {
    accrue(email);
    ghs = Math.round(Number(ghs));
    days = Math.round(Number(days || CFG.customDays));
    if (!(ghs >= CFG.customMinGhs)) throw new Error("Minimum custom hashrate is " + CFG.customMinGhs + " GH/s");
    if (ghs > CFG.customMaxGhs) throw new Error("Maximum custom hashrate is " + CFG.customMaxGhs + " GH/s");
    if (!(days >= 7)) throw new Error("Minimum contract length is 7 days");
    const priceUsd = customPrice(ghs, days);
    const paid = charge(email, priceUsd, currency, "Hashrate purchase — custom rig (" + fmtHash(ghs) + " / " + days + "d)");
    const c = addContract(email, {
      plan: "custom", name: "Custom Rig", ghs, days, priceUsd,
      paidWith: paid.paidWith, paidAmount: paid.paidAmount,
    });
    log(email, "buy", "Started a custom rig · " + fmtHash(ghs) + " for " + days + " days", -priceUsd);
    return c;
  }

  /* ---------- claiming ---------- */
  function claim(email, mode) {
    const s = accrue(email);
    const amount = round(s.unclaimed);
    if (!(amount >= CFG.minClaimUsdt)) {
      throw new Error("Minimum claim is " + W.usd(CFG.minClaimUsdt) + " — keep mining a little longer");
    }
    patch(email, (st) => { st.unclaimed = 0; st.claimed = round(st.claimed + amount); });

    if (mode === "points") {
      const pts = Math.floor(amount * pointsPerUsdt() * (1 + CFG.pointsBonusPct / 100));
      FF.awardCredits(email, pts, "Mining payout claimed (+" + CFG.pointsBonusPct + "% points bonus)");
      log(email, "claim", "Claimed " + W.usd(amount) + " as " + pts.toLocaleString("en-IN") + " points", amount);
      return { mode: "points", amount, points: pts };
    }

    W.patchWallet(email, (acc) => {
      acc.available = round(acc.available + amount);
      acc.totalEarned = round(acc.totalEarned + amount);
    });
    W.tx(email, "mining", amount, "Cloud mining payout", "completed");
    log(email, "claim", "Claimed " + W.usd(amount) + " to the USDT wallet", amount);
    return { mode: "usdt", amount };
  }

  /* ---------- free daily boost ---------- */
  function boostReadyIn(email) {
    const s = state(email);
    const next = (s.lastBoost || 0) + CFG.boostCooldownH * 3600000;
    return Math.max(0, next - Date.now());
  }

  function activateBoost(email) {
    accrue(email);
    if (hashrate(email) <= 0) throw new Error("Start a rig first — there is nothing to boost yet");
    if (boostReadyIn(email) > 0) throw new Error("Next free boost unlocks in " + fmtDur(boostReadyIn(email)));
    const now = Date.now();
    patch(email, (s) => {
      s.boostUntil = Math.max(s.boostUntil || 0, now) + CFG.boostHours * 3600000;
      s.lastBoost = now;
    });
    log(email, "boost", "+" + CFG.boostPct + "% speed boost for " + CFG.boostHours + " hours", 0);
    return state(email).boostUntil;
  }

  /* ---------- formatting ---------- */
  function fmtHash(ghs) {
    ghs = Number(ghs || 0);
    if (ghs >= 1000) return (ghs / 1000).toFixed(ghs % 1000 === 0 ? 0 : 2) + " TH/s";
    return (ghs % 1 === 0 ? ghs : ghs.toFixed(2)) + " GH/s";
  }

  function fmtDur(ms) {
    if (ms <= 0) return "0m";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const d = Math.floor(h / 24);
    if (d > 0) return d + "d " + (h % 24) + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function fmtUsd6(n) { return "$" + Number(n || 0).toFixed(6); }

  /* ---------- global network stats (cosmetic, deterministic) ---------- */
  function networkStats() {
    const day = Math.floor(Date.now() / 86400000);
    const wobble = (Math.sin(day * 1.7) + 1) / 2;
    return {
      poolHash: 48000 + Math.round(wobble * 9000),           // GH/s
      miners: 1820 + Math.round(wobble * 260),
      uptime: 99.2 + Math.round(wobble * 7) / 10,
    };
  }


  /* ============================================================
     SERVER LAYER
     When Supabase is configured and the member holds a real Auth session,
     mining is authoritative on the server: prices, elapsed time, balances
     and payouts are all recomputed by Postgres functions (see
     supabase-mining.sql), so editing localStorage changes nothing.
     Without a server session everything falls back to the browser-only
     simulation above, which keeps local previews and demo accounts working.
     ============================================================ */

  let snapshot = null;     // last server payload
  let snapshotAt = 0;      // when we received it
  let serverDown = false;  // set after an auth/offline failure

  function serverReady() {
    return !!(FF.hasServer && FF.hasServer() && !serverDown);
  }

  /* Normalised view used by the UI, identical in both modes. */
  function localSnapshot(email) {
    const s = stats(email);
    const st = state(email);
    const user = FF.currentUser() || {};
    return {
      mode: "local",
      config: {
        minClaimUsdt: CFG.minClaimUsdt, pointsBonusPct: CFG.pointsBonusPct,
        boostPct: CFG.boostPct, boostHours: CFG.boostHours,
        maintenancePct: CFG.maintenancePct, pointsPerUsdt: pointsPerUsdt(),
        customMinGhs: CFG.customMinGhs, customMaxGhs: CFG.customMaxGhs,
        netRate: netRate(),
      },
      plans: PLANS,
      balances: { usdt: W.wallet(email).available, points: Number(user.credits || 0) },
      ghs: s.ghs, perDay: s.perDay, unclaimed: s.unclaimed, claimed: s.claimed,
      lifetime: s.lifetime, active: s.active, invested: s.invested,
      boosted: s.boosted, boostUntil: s.boostUntil,
      boostReadyIn: boostReadyIn(email),
      contracts: st.contracts, log: st.log || [],
    };
  }

  function adoptServer(payload) {
    snapshot = payload;
    snapshotAt = Date.now();
    serverDown = false;
    return normalise(payload);
  }

  /* Pure: turns a server payload into the shape the UI renders. Must NOT
     touch snapshotAt, otherwise the per-second interpolation freezes. */
  function normalise(payload) {
    const cfg = payload.config || {};
    const acc = payload.account || {};
    const contracts = payload.contracts || [];
    const live = contracts.filter((c) => c.status === "active");
    const cooldownMs = (cfg.boost_cooldown_h || CFG.boostCooldownH) * 3600000;
    return {
      mode: "server",
      config: {
        minClaimUsdt: Number(cfg.min_claim_usdt != null ? cfg.min_claim_usdt : CFG.minClaimUsdt),
        pointsBonusPct: Number(cfg.points_bonus_pct != null ? cfg.points_bonus_pct : CFG.pointsBonusPct),
        boostPct: Number(cfg.boost_pct != null ? cfg.boost_pct : CFG.boostPct),
        boostHours: Number(cfg.boost_hours != null ? cfg.boost_hours : CFG.boostHours),
        maintenancePct: Number(cfg.maintenance_pct != null ? cfg.maintenance_pct : CFG.maintenancePct),
        pointsPerUsdt: Number(cfg.points_per_usdt || pointsPerUsdt()),
        customMinGhs: Number(cfg.custom_min_ghs || CFG.customMinGhs),
        customMaxGhs: Number(cfg.custom_max_ghs || CFG.customMaxGhs),
        customTiers: cfg.customTiers || null,
        customBaseDays: Number(cfg.custom_base_days || CFG.customDays),
        netRate: Number(cfg.netRate != null ? cfg.netRate : netRate()),
      },
      plans: (payload.plans || []).map((p) => ({
        key: p.key, name: p.name, tag: p.tag, ghs: Number(p.ghs), days: Number(p.days),
        priceUsd: Number(p.priceUsd), color: p.color, free: !!p.free,
        featured: !!p.featured, perks: p.perks || [],
      })),
      balances: {
        usdt: Number((payload.balances && payload.balances.usdt) || 0),
        points: Number((payload.balances && payload.balances.points) || 0),
      },
      ghs: Number(acc.ghs || 0),
      perDay: Number(acc.perDay || 0),
      unclaimed: Number(acc.unclaimed || 0),
      claimed: Number(acc.claimed || 0),
      lifetime: round(Number(acc.claimed || 0) + Number(acc.unclaimed || 0)),
      active: live.length,
      invested: contracts.reduce((n, c) => n + Number(c.priceUsd || 0), 0),
      boosted: !!acc.boosted,
      boostUntil: Number(acc.boostUntil || 0),
      boostReadyIn: Math.max(0, Number(acc.lastBoost || 0) + cooldownMs - Date.now()),
      contracts: contracts.map((c) => ({
        id: c.id, plan: c.plan, name: c.name, ghs: Number(c.ghs), days: Number(c.days),
        startedAt: Number(c.startedAt), endsAt: Number(c.endsAt), priceUsd: Number(c.priceUsd),
        paidWith: c.paidWith, paidAmount: Number(c.paidAmount), earned: Number(c.earned),
        status: c.status,
      })),
      log: (payload.log || []).map((l) => ({
        id: l.id, type: l.type, text: l.text, amount: Number(l.amount || 0), at: Number(l.at),
      })),
    };
  }

  /* Smoothly interpolate between server polls so the counter still ticks
     every second. The server value always wins on the next refresh. */
  function interpolate(view) {
    if (!view || view.mode !== "server") return view;
    const elapsed = Math.max(0, Date.now() - snapshotAt);
    const drift = (view.perDay / 86400000) * elapsed;
    const out = Object.assign({}, view);
    out.unclaimed = round(view.unclaimed + drift);
    out.lifetime = round(view.claimed + out.unclaimed);
    out.boosted = view.boostUntil > Date.now();
    out.boostReadyIn = Math.max(0, view.boostReadyIn - elapsed);
    return out;
  }

  /* Any RPC failure that is an auth/config problem drops us into local mode
     for the rest of the session; a real validation error is re-thrown. */
  function call(fn, args) {
    return FF.rpc(fn, args).then((payload) => adoptServer(payload)).catch((err) => {
      if (err && err.offline) { serverDown = true; throw Object.assign(err, { fellBack: true }); }
      throw err;
    });
  }

  const api = {
    isServer() { return !!(snapshot && !serverDown); },

    /* Current view without hitting the network. */
    view() {
      const u = FF.currentUser();
      if (!u) return null;
      if (snapshot && !serverDown) return interpolate(normalise(snapshot));
      return localSnapshot(u.email);
    },

    /* Fetch authoritative state; silently degrades to the local simulation. */
    load() {
      const u = FF.currentUser();
      if (!u) return Promise.resolve(null);
      if (!serverReady()) return Promise.resolve(localSnapshot(u.email));
      return call("mining_state").catch(() => localSnapshot(u.email));
    },

    buyPlan(key, currency) {
      const u = FF.currentUser();
      if (!u) return Promise.reject(new Error("Please log in"));
      if (!serverReady()) return Promise.resolve().then(() => { buyPlan(u.email, key, currency); return localSnapshot(u.email); });
      return call("mining_buy_plan", { p_plan: key, p_currency: currency }).catch((err) => {
        if (err.fellBack) { buyPlan(u.email, key, currency); return localSnapshot(u.email); }
        throw err;
      });
    },

    buyCustom(ghs, days, currency) {
      const u = FF.currentUser();
      if (!u) return Promise.reject(new Error("Please log in"));
      if (!serverReady()) return Promise.resolve().then(() => { buyCustom(u.email, ghs, days, currency); return localSnapshot(u.email); });
      return call("mining_buy_custom", { p_ghs: Math.round(ghs), p_days: Math.round(days), p_currency: currency }).catch((err) => {
        if (err.fellBack) { buyCustom(u.email, ghs, days, currency); return localSnapshot(u.email); }
        throw err;
      });
    },

    claim(mode) {
      const u = FF.currentUser();
      if (!u) return Promise.reject(new Error("Please log in"));
      snapshotPrevUnclaimed = (this.view() || {}).unclaimed || 0;
      if (!serverReady()) return Promise.resolve().then(() => { const r = claim(u.email, mode); const v = localSnapshot(u.email); v.claimResult = r; return v; });
      return call("mining_claim", { p_mode: mode }).then((v) => {
        v.claimResult = { mode, amount: round(Math.max(0, (snapshotPrevUnclaimed || 0))) };
        return v;
      }).catch((err) => {
        if (err.fellBack) { const r = claim(u.email, mode); const v = localSnapshot(u.email); v.claimResult = r; return v; }
        throw err;
      });
    },

    boost() {
      const u = FF.currentUser();
      if (!u) return Promise.reject(new Error("Please log in"));
      if (!serverReady()) return Promise.resolve().then(() => { activateBoost(u.email); return localSnapshot(u.email); });
      return call("mining_boost").catch((err) => {
        if (err.fellBack) { activateBoost(u.email); return localSnapshot(u.email); }
        throw err;
      });
    },

    /* Price of a custom rig using whichever tier table is in force. */
    priceCustom(view, ghs, days) {
      const tiers = view && view.config && view.config.customTiers;
      if (!tiers || !tiers.length) return customPrice(ghs, days);
      const base = (view.config.customBaseDays || CFG.customDays);
      const tier = tiers.find((t) => ghs <= Number(t.upTo)) || tiers[tiers.length - 1];
      return Math.round(ghs * Number(tier.usdPerGhs) * (days / base) * 100) / 100;
    },

    pointsPrice(view, usd) {
      const rate = (view && view.config && view.config.pointsPerUsdt) || pointsPerUsdt();
      return Math.ceil(Number(usd || 0) * rate);
    },

    dailyUsd(view, ghs) {
      const rate = (view && view.config && view.config.netRate) || netRate();
      return ghs * rate;
    },
  };

  let snapshotPrevUnclaimed = 0;

  /* ---------- pills ---------- */
  function syncMiningPills() {
    const u = FF.currentUser();
    if (!u) return;
    const s = stats(u.email);
    document.querySelectorAll("[data-mine-hash]").forEach((el) => (el.textContent = fmtHash(s.ghs)));
    document.querySelectorAll("[data-mine-unclaimed]").forEach((el) => (el.textContent = Number(s.unclaimed).toFixed(4)));
  }

  const RIG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></svg>';

  document.addEventListener("DOMContentLoaded", () => {
    const u = FF.currentUser();
    if (u) accrue(u.email);
    document.querySelectorAll("[data-mine-icon]").forEach((el) => (el.innerHTML = RIG_SVG));
    syncMiningPills();
  });

  FF.M = {
    CFG, PLANS, plan, RIG_SVG,
    netRate, customRate, pointsPrice, dailyUsd, totalUsd, roi, customPrice,
    state, stats, accrue, hashrate, activeContracts, boostActive, boostReadyIn,
    buyPlan, buyCustom, claim, activateBoost,
    fmtHash, fmtDur, fmtUsd6, networkStats, syncMiningPills,
    api, serverReady,
  };
})();
