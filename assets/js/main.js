/* ============================================================
   FLEXFAM — shared engine
   Browser campaign cache + Supabase Auth for member sign-in when configured.
   Raw passwords are never saved in browser storage or exposed in the admin area.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- platform registry ---------- */
  const PLATFORMS = {
    telegram: {
      key: "telegram",
      name: "Telegram",
      color: "#2aabee",
      actions: ["Join Channel", "Join Group", "Start Bot", "Boost Post"],
      hint: "t.me/",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.04 15.31l-.38 5.32c.54 0 .77-.23 1.05-.5l2.52-2.41 5.22 3.83c.96.53 1.64.25 1.9-.88L21.9 4.6c.34-1.4-.5-1.94-1.44-1.6L2.2 9.92c-1.36.53-1.34 1.28-.23 1.62l4.62 1.44L17.3 6.1c.5-.33.96-.15.58.18L9.04 15.3z"/></svg>',
    },
    youtube: {
      key: "youtube",
      name: "YouTube",
      color: "#ff3355",
      actions: ["Subscribe", "Watch Video", "Like Video"],
      hint: "youtube.com or youtu.be",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 12s0-3.83-.49-5.68a2.94 2.94 0 0 0-2.07-2.07C18.63 3.75 12 3.75 12 3.75s-6.63 0-8.44.5A2.94 2.94 0 0 0 1.5 6.32C1 8.17 1 12 1 12s0 3.83.5 5.68a2.94 2.94 0 0 0 2.06 2.07c1.81.5 8.44.5 8.44.5s6.63 0 8.44-.5a2.94 2.94 0 0 0 2.07-2.07C23 15.83 23 12 23 12zM9.75 15.5v-7L15.5 12l-5.75 3.5z"/></svg>',
    },
    instagram: {
      key: "instagram",
      name: "Instagram",
      color: "#e1306c",
      actions: ["Follow", "Like Post", "View Reel"],
      hint: "instagram.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6.01 4.85.07 3.25.15 4.77 1.7 4.92 4.92.06 1.26.07 1.63.07 4.85s-.01 3.6-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.63.07-4.85.07s-3.6-.01-4.85-.07c-3.25-.15-4.77-1.7-4.92-4.92C2.17 15.6 2.16 15.22 2.16 12s.01-3.6.07-4.85C2.38 3.93 3.9 2.42 7.15 2.27 8.4 2.21 8.77 2.2 12 2.2zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.25a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5zm5.2-9.65a1.17 1.17 0 1 0 2.34 0 1.17 1.17 0 0 0-2.34 0z"/></svg>',
    },
    x: {
      key: "x",
      name: "X (Twitter)",
      color: "#e7e9ea",
      actions: ["Follow", "Repost", "Like Post"],
      hint: "x.com or twitter.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zM17.6 20.65h2.04L6.49 3.24H4.3l13.3 17.4z"/></svg>',
    },
    tiktok: {
      key: "tiktok",
      name: "TikTok",
      color: "#25f4ee",
      actions: ["Follow", "Like Video", "Watch Video"],
      hint: "tiktok.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-2.31-2.83V9.36a6.34 6.34 0 1 0 5.76 6.31V8.75a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.18z"/></svg>',
    },
    facebook: {
      key: "facebook",
      name: "Facebook",
      color: "#1877f2",
      actions: ["Like Page", "Follow", "Like Post"],
      hint: "facebook.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 .8-5.09 4.9-5.09l2.62.03v4.42h-1.9c-1.01 0-1.45.85-1.45 1.72V12h3.8l-.61 3.47h-3.19v8.38A12 12 0 0 0 24 12z"/></svg>',
    },
    twitch: {
      key: "twitch",
      name: "Twitch",
      color: "#a970ff",
      actions: ["Follow", "Watch Stream"],
      hint: "twitch.tv",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.3 1L1.5 5.25v16.5h5.4V24h3l2.25-2.25h3.45L21 16.35V1H4.3zm15.2 14.4L16.75 18H13.5l-2.25 2.25V18H6.6V2.5h12.9v12.9zM16.3 6.4v5.4h-1.8V6.4h1.8zm-4.95 0v5.4H9.55V6.4h1.8z"/></svg>',
    },
    pinterest: {
      key: "pinterest",
      name: "Pinterest",
      color: "#ff4f6d",
      actions: ["Follow", "Save Pin"],
      hint: "pinterest.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.08 2.46 7.58 5.98 9.12-.08-.78-.16-1.97.03-2.82.17-.74 1.1-4.68 1.1-4.68s-.28-.56-.28-1.39c0-1.3.76-2.27 1.7-2.27.8 0 1.19.6 1.19 1.32 0 .8-.51 2.01-.78 3.13-.22.94.47 1.7 1.4 1.7 1.67 0 2.96-1.77 2.96-4.32 0-2.26-1.62-3.84-3.94-3.84-2.68 0-4.26 2.01-4.26 4.09 0 .81.31 1.68.7 2.15.08.1.09.19.07.29-.07.32-.24 1-.27 1.14-.04.18-.14.22-.33.13-1.25-.58-2.03-2.4-2.03-3.87 0-3.15 2.29-6.04 6.6-6.04 3.46 0 6.16 2.47 6.16 5.77 0 3.44-2.17 6.22-5.19 6.22-1.01 0-1.97-.53-2.29-1.15l-.62 2.37c-.23.87-.84 1.95-1.25 2.61.94.29 1.94.45 2.97.45 5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>',
    },
    website: {
      key: "website",
      name: "Website Visit",
      color: "#34e5a5",
      actions: ["Visit Website", "Read Article", "Explore Page", "Sign Up"],
      hint: "website URL",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    },
  };

  const BRAND_SVG = '<svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="fflg" x1="0" y1="0" x2="48" y2="48"><stop stop-color="#7c3aed"/><stop offset="0.55" stop-color="#e0489f"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="13" fill="url(#fflg)"/><path d="M15 34V14h15.5v4.6h-10v4.2h8.4v4.6h-8.4V34H15z" fill="#fff"/><circle cx="33" cy="31.5" r="4.6" fill="#fff" opacity="0.92"/></svg>';

  const COIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.2c-.5-1-1.6-1.6-3-1.6-1.8 0-3 1-3 2.4 0 3.4 6 1.8 6 4.7 0 1.5-1.3 2.6-3.2 2.6-1.5 0-2.7-.7-3.2-1.8"/></svg>';
  const SPARK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const WARN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>';

  /* ---------- storage helpers ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  };

  const DB = {
    users() { return store.get("ff_users", []); },
    saveUsers(u) { store.set("ff_users", u); },
    session() { return store.get("ff_session", null); },
    setSession(email) { store.set("ff_session", email); },
    campaigns() { return store.get("ff_campaigns", []); },
    saveCampaigns(c) { store.set("ff_campaigns", c); },
    doneMap() { return store.get("ff_done", {}); },
    saveDoneMap(d) { store.set("ff_done", d); },
  };

  function currentUser() {
    const email = DB.session();
    if (!email) return null;
    return DB.users().find((u) => u.email === email) || null;
  }

  function updateUser(email, patch) {
    const users = DB.users();
    const i = users.findIndex((u) => u.email === email);
    if (i > -1) {
      users[i] = Object.assign({}, users[i], patch);
      DB.saveUsers(users);
    }
    return users[i];
  }


  /* ---------- member auth ---------- */
  function memberConfig() {
    const cfg = window.FF_SUPABASE_CONFIG || null;
    const valid = cfg && cfg.url && cfg.anonKey &&
      !String(cfg.url).includes("your-project") && !String(cfg.anonKey).includes("your-anon");
    return valid ? cfg : null;
  }

  function makeLocalMemberId() {
    const bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now(); bytes[1] = Math.floor(Math.random() * 0xffffffff); }
    return "FF-" + Array.from(bytes).map((n) => n.toString(36)).join("").toUpperCase().slice(0, 12);
  }

  function defaultMember(name, email, memberId) {
    return {
      name,
      email,
      memberId: memberId || makeLocalMemberId(),
      credits: 25,
      earned: 25,
      spent: 0,
      refCode: "FF-" + name.replace(/\s+/g, "").slice(0, 4).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000),
      joined: Date.now(),
      activity: [{ type: "earn", text: "Welcome bonus — glad to have you on FlexFam!", amount: 25, at: Date.now() }],
      campaigns: [],
      weekly: [42, 68, 55, 90, 74, 110, 96],
    };
  }

  function rememberMember(name, email, memberId) {
    const users = DB.users();
    const i = users.findIndex((u) => u.email === email);
    if (i === -1) {
      const member = defaultMember(name || email.split("@")[0], email, memberId);
      users.push(member);
      DB.saveUsers(users);
      return member;
    }
    const user = users[i];
    const patch = {};
    if (name) patch.name = name;
    if (memberId) patch.memberId = memberId;
    if (Object.keys(patch).length || Object.prototype.hasOwnProperty.call(user, "pass")) {
      users[i] = Object.assign({}, user, patch);
      /* A verified Supabase account replaces the legacy browser password. */
      delete users[i].pass;
      DB.saveUsers(users);
    }
    return users[i];
  }

  function authRequest(path, options) {
    const cfg = memberConfig();
    if (!cfg) return Promise.reject(new Error("Secure sign-up is not configured yet"));
    options = options || {};
    return fetch(String(cfg.url).replace(/\/+$/, "") + path, {
      method: options.method || "POST",
      headers: Object.assign({
        apikey: cfg.anonKey,
        Authorization: "Bearer " + cfg.anonKey,
        "Content-Type": "application/json",
      }, options.headers || {}),
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then((res) => res.text().then((text) => {
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) {}
      if (!res.ok) throw new Error((json && (json.msg || json.message || json.error_description || json.error)) || "Request failed (" + res.status + ")");
      return json || {};
    }));
  }

  function passwordDigest(password, salt) {
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.reject(new Error("This browser needs HTTPS to store a local password safely"));
    }
    const encoder = new TextEncoder();
    /* The fallback is only used without Supabase, but it still uses a slow,
       salted PBKDF2 derivation instead of writing a password in plain text. */
    return window.crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"])
      .then((key) => window.crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: encoder.encode(salt),
        iterations: 100000,
        hash: "SHA-256",
      }, key, 256))
      .then((buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join(""));
  }

  function localPasswordRecord(password) {
    if (!window.crypto || !window.crypto.getRandomValues) {
      return Promise.reject(new Error("This browser needs HTTPS to store a local password safely"));
    }
    const bytes = new Uint32Array(2);
    window.crypto.getRandomValues(bytes);
    const salt = Array.from(bytes).map((n) => n.toString(36)).join("-");
    return passwordDigest(password, salt).then((digest) => ({ passwordSalt: salt, passwordDigest: digest }));
  }

  function replaceLegacyPassword(email, record) {
    const users = DB.users();
    const i = users.findIndex((u) => u.email === email);
    if (i < 0) return;
    const clean = Object.assign({}, users[i], record);
    delete clean.pass;
    users[i] = clean;
    DB.saveUsers(users);
  }

  function localSignup(name, email, password) {
    return localPasswordRecord(password).then((record) => {
      const users = DB.users();
      if (users.some((u) => u.email === email)) throw new Error("This email is already registered — please log in");
      const member = Object.assign(defaultMember(name, email), record);
      users.push(member);
      DB.saveUsers(users);
      DB.setSession(email);
      return { member, confirmationRequired: false, localOnly: true };
    });
  }

  function localLogin(email, password) {
    const user = DB.users().find((u) => u.email === email);
    if (!user) return Promise.reject(new Error("No account found on this browser yet — please sign up first"));
    if (user.passwordDigest && user.passwordSalt) {
      return passwordDigest(password, user.passwordSalt).then((digest) => {
        if (digest !== user.passwordDigest) throw new Error("Incorrect email or password");
        DB.setSession(email);
        return user;
      });
    }
    /* Upgrade old browser-only accounts after their next successful login. */
    if (typeof user.pass === "string" && user.pass === password) {
      return localPasswordRecord(password).then((record) => {
        replaceLegacyPassword(email, record);
        DB.setSession(email);
        return currentUser();
      });
    }
    return Promise.reject(new Error("Incorrect email or password"));
  }

  function signupMember(name, email, password) {
    const cfg = memberConfig();
    if (!cfg) return localSignup(name, email, password);
    return authRequest("/auth/v1/signup", {
      body: { email, password, data: { display_name: name } },
    }).then((result) => {
      if (!result.user || !result.user.id) throw new Error("The account could not be created. Please try again.");
      const member = rememberMember(name, email, result.user.id);
      if (result.session) DB.setSession(email);
      return { member, confirmationRequired: !result.session, localOnly: false };
    });
  }

  function loginMember(email, password) {
    const cfg = memberConfig();
    if (!cfg) return localLogin(email, password);
    return authRequest("/auth/v1/token?grant_type=password", {
      body: { email, password },
    }).then((result) => {
      if (!result.user) throw new Error("Incorrect email or password");
      const profileName = result.user.user_metadata && result.user.user_metadata.display_name;
      const member = rememberMember(profileName || email.split("@")[0], email, result.user.id);
      DB.setSession(email);
      return member;
    }).catch((error) => {
      /* Existing demo/local accounts remain usable after this secure upgrade. */
      const cached = DB.users().find((u) => u.email === email);
      if (cached && (cached.passwordDigest || cached.pass)) return localLogin(email, password);
      throw error;
    });
  }

  /* ---------- seed demo data ---------- */
  const SEED_NAMES = [
    "Aarav Shots", "Neha Vlogs", "UrbanBeatz", "Kavya Creates", "TechGuru Rohan",
    "FitWithSimran", "PixelNinja", "DesiFoodies", "GameLordYT", "MelodyMaya",
    "TravelTales.in", "CoderKiBaatein", "StyleSansar", "CricketFever", "ArtByIra",
    "FinanceWala", "DailyMotivation", "GadgetGram", "DanceWithDev", "BookishBella",
  ];

  function seededRand(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967295; };
  }

  const SEED_VERSION = 3;

  function buildSeedCampaigns() {
    const keys = Object.keys(PLATFORMS);
    const list = [];
    const rnd = seededRand("flexfam-genesis-v2");
    let id = 1;
    keys.forEach((pk) => {
      const p = PLATFORMS[pk];
      const per = pk === "telegram" ? 5 : pk === "website" ? 5 : 3;
      for (let i = 0; i < per; i++) {
        const name = SEED_NAMES[Math.floor(rnd() * SEED_NAMES.length)];
        const action = p.actions[Math.floor(rnd() * p.actions.length)];
        const payout = [2, 3, 4, 5, 6][Math.floor(rnd() * 5)];
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const urls = {
          telegram: action === "Start Bot" ? "https://t.me/" + slug + "bot?start=flexfam" : "https://t.me/" + slug,
          youtube: "https://youtube.com/@" + slug,
          instagram: "https://instagram.com/" + slug,
          x: "https://x.com/" + slug,
          tiktok: "https://tiktok.com/@" + slug,
          facebook: "https://facebook.com/" + slug,
          twitch: "https://twitch.tv/" + slug,
          pinterest: "https://pinterest.com/" + slug,
          website: "https://example.com/?ref=" + slug,
        };
        list.push({
          id: "c" + id++,
          platform: pk,
          action,
          user: name,
          title: name + " · " + action,
          url: urls[pk],
          payout,
          mine: false,
        });
      }
    });
    return list;
  }

  const EXTRA_SEED_CAMPAIGNS = [
    {
      id: "seed-bot-start-flexfam",
      platform: "telegram",
      action: "Start @sub_for_sub_bot",
      user: "FlexFam Rewards Bot (@sub_for_sub_bot)",
      title: "FlexFam Rewards Bot (@sub_for_sub_bot) · Start @sub_for_sub_bot",
      url: "https://t.me/sub_for_sub_bot?start=web_bonus",
      payout: 15,
      mine: false,
    },
    {
      id: "seed-bot-start-deals",
      platform: "telegram",
      action: "Start Bot",
      user: "Deals Radar Bot",
      title: "Deals Radar Bot · Start Bot",
      url: "https://t.me/dealsradarbot?start=flexfam",
      payout: 10,
      mine: false,
    },
    {
      id: "seed-web-visit-home",
      platform: "website",
      action: "Visit Website",
      user: "FlexFam Home",
      title: "FlexFam Home · Visit Website",
      url: "index.html#platforms",
      payout: 6,
      mine: false,
    },
    {
      id: "seed-web-read-guide",
      platform: "website",
      action: "Read Article",
      user: "Creator Growth Guide",
      title: "Creator Growth Guide · Read Article",
      url: "index.html#how",
      payout: 5,
      mine: false,
    },
    {
      id: "seed-web-explore-offer",
      platform: "website",
      action: "Explore Page",
      user: "Turbo Perks Page",
      title: "Turbo Perks Page · Explore Page",
      url: "index.html#pricing",
      payout: 4,
      mine: false,
    },
  ];

  function seedCampaigns() {
    const version = store.get("ff_seed_version", 0);
    let list = DB.campaigns();
    const needsFreshSeed = !store.get("ff_seeded", false) || !Array.isArray(list) || !list.length;

    if (needsFreshSeed) {
      list = buildSeedCampaigns();
    }

    if (version < SEED_VERSION) {
      EXTRA_SEED_CAMPAIGNS.slice().reverse().forEach((c) => {
        const existingIndex = list.findIndex((item) => item.id === c.id);
        if (existingIndex > -1) {
          list[existingIndex] = Object.assign({}, list[existingIndex], c);
        } else {
          list.unshift(c);
        }
      });
    }

    DB.saveCampaigns(list);
    store.set("ff_seeded", true);
    store.set("ff_seed_version", SEED_VERSION);
  }

  /* ---------- credits engine ---------- */
  function addActivity(user, type, text, amount) {
    const act = user.activity || [];
    act.unshift({ type, text, amount, at: Date.now() });
    return act.slice(0, 40);
  }

  function awardCredits(email, amount, text) {
    const user = updateUser(email, {});
    if (!user) return;
    const patch = {
      credits: (user.credits || 0) + amount,
      earned: (user.earned || 0) + amount,
    };
    patch.activity = addActivity(Object.assign({}, user, patch), "earn", text, amount);
    updateUser(email, patch);
    syncCreditPills();
  }

  function spendCredits(email, amount, text) {
    const user = updateUser(email, {});
    if (!user || (user.credits || 0) < amount) return false;
    const patch = {
      credits: user.credits - amount,
      spent: (user.spent || 0) + amount,
    };
    patch.activity = addActivity(Object.assign({}, user, patch), "spend", text, -amount);
    updateUser(email, patch);
    syncCreditPills();
    return true;
  }

  function syncCreditPills() {
    const u = currentUser();
    document.querySelectorAll("[data-credits]").forEach((el) => {
      el.textContent = u ? String(u.credits || 0).toLocaleString("en-IN") : "0";
    });
  }

  /* ---------- toast ---------- */
  function toast(msg, kind) {
    kind = kind || "ok";
    let root = document.querySelector(".toast-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "toast-root";
      document.body.appendChild(root);
    }
    const icons = { ok: CHECK_SVG, err: WARN_SVG, info: SPARK_SVG };
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = '<span class="t-ic">' + icons[kind] + "</span><span>" + msg + "</span>";
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 350);
    }, 3400);
  }

  /* ---------- avatar ---------- */
  const AV_COLORS = ["#7c3aed", "#e0489f", "#22d3ee", "#ff8a3d", "#34e5a5", "#a970ff", "#ff4f6d", "#2aabee"];
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  /* ---------- header + nav ---------- */
  function initHeader() {
    const head = document.querySelector(".site-head");
    if (!head) return;
    /* rAF-throttled: the raw scroll handler was toggling a class (and the
       blurred header) on every scroll event, which janked Chrome badly */
    let ticking = false, scrolled = null;
    const apply = () => {
      ticking = false;
      const next = window.scrollY > 24;
      if (next === scrolled) return;
      scrolled = next;
      head.classList.toggle("scrolled", next);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(apply); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    apply();

    const burger = document.querySelector(".burger");
    const mnav = document.querySelector(".mobile-nav");
    if (burger && mnav) {
      burger.addEventListener("click", () => {
        burger.classList.toggle("open");
        mnav.classList.toggle("open");
        document.body.style.overflow = mnav.classList.contains("open") ? "hidden" : "";
      });
      mnav.querySelectorAll("a").forEach((a) =>
        a.addEventListener("click", () => {
          burger.classList.remove("open");
          mnav.classList.remove("open");
          document.body.style.overflow = "";
        })
      );
    }
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.12 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  }

  /* ---------- counters ---------- */
  function initCounters() {
    const els = document.querySelectorAll("[data-count]");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const target = parseFloat(e.target.dataset.count);
        const suffix = e.target.dataset.suffix || "";
        const dur = 1600;
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min((t - t0) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 4);
          const val = target * eased;
          e.target.textContent = (target % 1 !== 0 ? val.toFixed(1) : Math.floor(val).toLocaleString("en-IN")) + suffix;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
      { threshold: 0.4 }
    );
    els.forEach((el) => io.observe(el));
  }

  /* ---------- hero tilt ---------- */
  function initTilt() {
    const card = document.querySelector("[data-tilt]");
    if (!card || window.matchMedia("(pointer: coarse)").matches) return;
    const wrap = card.parentElement;
    /* mousemove fires far more often than the display refreshes — batch it */
    let rafId = 0, mx = 0, my = 0, rect = null;
    const paint = () => {
      rafId = 0;
      card.style.transform = "rotateY(" + mx * 10 + "deg) rotateX(" + -my * 10 + "deg)";
    };
    wrap.addEventListener("mousemove", (e) => {
      if (!rect) rect = card.getBoundingClientRect();
      mx = (e.clientX - rect.left) / rect.width - 0.5;
      my = (e.clientY - rect.top) / rect.height - 0.5;
      if (!rafId) rafId = requestAnimationFrame(paint);
    }, { passive: true });
    wrap.addEventListener("mouseenter", () => { rect = card.getBoundingClientRect(); });
    window.addEventListener("scroll", () => { rect = null; }, { passive: true });
    wrap.addEventListener("mouseleave", () => { card.style.transform = "rotateY(0) rotateX(0)"; });
  }

  /* ---------- activity ticker ---------- */
  function initTicker() {
    const el = document.getElementById("ticker-text");
    if (!el) return;
    /* Static text intentionally replaces a permanent interval + repaint loop. */
    el.innerHTML = '<b>@aaravshots</b> started <b>FlexFam Rewards Bot (@sub_for_sub_bot)</b> on Telegram &amp; earned <b>+15</b> points';
  }

  /* ---------- auth guard ---------- */
  function guard() {
    if (document.body.hasAttribute("data-requires-auth")) {
      const u = currentUser();
      if (!u) {
        window.location.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop());
        return;
      }
    }
  }

  /* ---------- auth pages ---------- */
  function initAuth() {
    const signupForm = document.getElementById("signup-form");
    if (signupForm) {
      signupForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const nameEl = signupForm.querySelector("#name, [name='name']");
        const emailEl = signupForm.querySelector("#email, [name='email']");
        const passEl = signupForm.querySelector("#password, [name='password']");
        const submit = signupForm.querySelector("button[type='submit']");
        if (!nameEl || !emailEl || !passEl) return toast("Signup form is broken — please reload the page", "err");
        const name = nameEl.value.trim();
        const email = emailEl.value.trim().toLowerCase();
        const pass = passEl.value;
        if (name.length < 2) return toast("Please enter your name (min 2 characters)", "err");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Please enter a valid email", "err");
        if (pass.length < 8) return toast("Use at least 8 characters for your password", "err");
        if (submit) { submit.disabled = true; submit.dataset.label = submit.textContent; submit.textContent = "Creating secure account…"; }
        signupMember(name, email, pass).then((result) => {
          passEl.value = "";
          if (result.confirmationRequired) {
            toast("Account created — check your email to confirm it, then log in.", "ok");
            setTimeout(() => (window.location.href = "login.html"), 1800);
            return;
          }
          toast(result.localOnly ? "Account created in this browser. Configure Supabase for admin-visible members." : "Account created! +25 welcome points", "ok");
          setTimeout(() => (window.location.href = "dashboard.html"), 900);
        }).catch((error) => {
          toast(error.message || "Could not create the account", "err");
        }).finally(() => {
          if (submit) { submit.disabled = false; submit.textContent = submit.dataset.label || "Create Account"; }
        });
      });
    }

    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const emailEl = loginForm.querySelector("#email, [name='email']");
        const passEl = loginForm.querySelector("#password, [name='password']");
        const submit = loginForm.querySelector("button[type='submit']");
        if (!emailEl || !passEl) return toast("Login form is broken — please reload the page", "err");
        const email = emailEl.value.trim().toLowerCase();
        const pass = passEl.value;
        if (!email || !pass) return toast("Enter your email and password", "err");
        if (submit) { submit.disabled = true; submit.dataset.label = submit.textContent; submit.textContent = "Logging in…"; }
        loginMember(email, pass).then((user) => {
          passEl.value = "";
          toast("Welcome back, " + user.name.split(" ")[0] + "!", "ok");
          const params = new URLSearchParams(location.search);
          setTimeout(() => (window.location.href = params.get("next") || "dashboard.html"), 800);
        }).catch((error) => {
          toast(error.message || "Incorrect email or password", "err");
        }).finally(() => {
          if (submit) { submit.disabled = false; submit.textContent = submit.dataset.label || "Login"; }
        });
      });
    }

    /* demo one-click login stays local and has no production password. */
    const demoBtn = document.getElementById("demo-login");
    if (demoBtn) {
      demoBtn.addEventListener("click", () => {
        const users = DB.users();
        let demo = users.find((u) => u.email === "demo@flexfam.io");
        if (!demo) {
          demo = {
            name: "Demo Star", email: "demo@flexfam.io", memberId: "FF-DEMO-2025",
            credits: 1240, earned: 3870, spent: 2630,
            refCode: "FF-DEMO-2025", joined: Date.now(),
            activity: [
              { type: "earn", text: 'Started "FlexFam Rewards Bot (@sub_for_sub_bot)" on Telegram', amount: 15, at: Date.now() - 1000 * 60 * 8 },
              { type: "earn", text: 'Visited "Creator Growth Guide" website', amount: 6, at: Date.now() - 1000 * 60 * 18 },
              { type: "earn", text: 'Subscribed "TechGuru Rohan" on YouTube', amount: 6, at: Date.now() - 1000 * 60 * 26 },
              { type: "spend", text: 'Promoted "Demo Star" Instagram page', amount: -12, at: Date.now() - 1000 * 60 * 70 },
              { type: "earn", text: 'Followed "MelodyMaya" on Instagram', amount: 3, at: Date.now() - 1000 * 60 * 130 },
            ],
            campaigns: [
              { id: "m1", platform: "telegram", title: "Demo Star Official", url: "https://t.me/demostar", payout: 12, active: true, actions: 48, spent: 576 },
              { id: "m2", platform: "instagram", title: "@demostar", url: "https://instagram.com/demostar", payout: 10, active: true, actions: 63, spent: 630 },
              { id: "m3", platform: "website", title: "Demo Star Landing Page", url: "https://example.com/demostar", payout: 6, active: true, actions: 29, spent: 174 },
            ],
            weekly: [42, 68, 55, 90, 74, 110, 96],
          };
          users.push(demo);
          DB.saveUsers(users);
        } else if (Object.prototype.hasOwnProperty.call(demo, "pass")) {
          /* The demo button does not need a password; scrub the legacy value. */
          delete demo.pass;
          DB.saveUsers(users);
        }
        DB.setSession("demo@flexfam.io");
        toast("Logged into the demo account!", "ok");
        setTimeout(() => (window.location.href = "dashboard.html"), 700);
      });
    }

    document.querySelectorAll("[data-logout]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        DB.setSession(null);
        toast("Logged out. See you soon!", "info");
        setTimeout(() => (window.location.href = "index.html"), 700);
      })
    );
  }

  /* ---------- personalised header ---------- */
  function paintUserUI() {
    const u = currentUser();
    document.querySelectorAll("[data-user-name]").forEach((el) => { if (u) el.textContent = u.name; });
    document.querySelectorAll("[data-user-avatar]").forEach((el) => {
      if (u) {
        el.textContent = initials(u.name);
        el.style.background = avatarColor(u.name);
      }
    });
    syncCreditPills();
    /* swap auth buttons if logged in */
    if (u) {
      document.querySelectorAll("[data-guest-only]").forEach((el) => el.classList.add("hidden"));
      document.querySelectorAll("[data-user-only]").forEach((el) => el.classList.remove("hidden"));
    } else {
      document.querySelectorAll("[data-user-only]").forEach((el) => el.classList.add("hidden"));
    }
  }

  /* Continuous decoration was removed for Chrome performance, so there is
     no offscreen animation work left to observe or pause. */
  function initAnimPause() {}

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    seedCampaigns();
    guard();
    initHeader();
    initAuth();
    paintUserUI();
    initReveal();
    initCounters();
    initTilt();
    initTicker();
    initAnimPause();
    document.querySelectorAll("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

    /* inject shared SVGs */
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const k = el.getAttribute("data-icon");
      if (PLATFORMS[k]) el.innerHTML = PLATFORMS[k].icon;
    });
    document.querySelectorAll("[data-brand]").forEach((el) => (el.innerHTML = BRAND_SVG));
    document.querySelectorAll("[data-coin]").forEach((el) => (el.innerHTML = COIN_SVG));
  });

  /* expose */
  window.FF = {
    PLATFORMS, BRAND_SVG, COIN_SVG, SPARK_SVG, CHECK_SVG,
    store, DB, currentUser, updateUser, memberConfig,
    awardCredits, spendCredits, syncCreditPills,
    toast, avatarColor, initials,
  };
})();
