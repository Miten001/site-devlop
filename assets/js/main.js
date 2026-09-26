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
      color: "#ff0000",
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
      color: "#15202b",
      actions: ["Follow", "Repost", "Like Post"],
      hint: "x.com or twitter.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zM17.6 20.65h2.04L6.49 3.24H4.3l13.3 17.4z"/></svg>',
    },
    tiktok: {
      key: "tiktok",
      name: "TikTok",
      color: "#010101",
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
      color: "#7c5cff",
      actions: ["Follow", "Watch Stream"],
      hint: "twitch.tv",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.3 1L1.5 5.25v16.5h5.4V24h3l2.25-2.25h3.45L21 16.35V1H4.3zm15.2 14.4L16.75 18H13.5l-2.25 2.25V18H6.6V2.5h12.9v12.9zM16.3 6.4v5.4h-1.8V6.4h1.8zm-4.95 0v5.4H9.55V6.4h1.8z"/></svg>',
    },
    pinterest: {
      key: "pinterest",
      name: "Pinterest",
      color: "#e60023",
      actions: ["Follow", "Save Pin"],
      hint: "pinterest.com",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.08 2.46 7.58 5.98 9.12-.08-.78-.16-1.97.03-2.82.17-.74 1.1-4.68 1.1-4.68s-.28-.56-.28-1.39c0-1.3.76-2.27 1.7-2.27.8 0 1.19.6 1.19 1.32 0 .8-.51 2.01-.78 3.13-.22.94.47 1.7 1.4 1.7 1.67 0 2.96-1.77 2.96-4.32 0-2.26-1.62-3.84-3.94-3.84-2.68 0-4.26 2.01-4.26 4.09 0 .81.31 1.68.7 2.15.08.1.09.19.07.29-.07.32-.24 1-.27 1.14-.04.18-.14.22-.33.13-1.25-.58-2.03-2.4-2.03-3.87 0-3.15 2.29-6.04 6.6-6.04 3.46 0 6.16 2.47 6.16 5.77 0 3.44-2.17 6.22-5.19 6.22-1.01 0-1.97-.53-2.29-1.15l-.62 2.37c-.23.87-.84 1.95-1.25 2.61.94.29 1.94.45 2.97.45 5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>',
    },
    website: {
      key: "website",
      name: "Website Visit",
      color: "#17b26a",
      actions: ["Visit Website", "Read Article", "Explore Page", "Sign Up"],
      hint: "website URL",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    },
  };

  const BRAND_SVG = '<svg viewBox=\"0 0 48 48\" fill=\"none\"><defs><linearGradient id=\"fflg\" x1=\"6\" y1=\"4\" x2=\"42\" y2=\"46\"><stop stop-color=\"#ffb547\"/><stop offset=\"0.55\" stop-color=\"#f7941d\"/><stop offset=\"1\" stop-color=\"#f2700a\"/></linearGradient></defs><rect x=\"2\" y=\"2\" width=\"44\" height=\"44\" rx=\"13\" fill=\"url(#fflg)\"/><path d=\"M15.6 34.8V13.2A2.2 2.2 0 0 1 17.8 11h14.4a2.2 2.2 0 0 1 2.2 2.2v1.6a2.2 2.2 0 0 1-2.2 2.2h-11v4.6h8.4a2.2 2.2 0 0 1 2.2 2.2v1.6a2.2 2.2 0 0 1-2.2 2.2h-8.4v9.4a2.2 2.2 0 0 1-2.2 2.2h-1.2a2.2 2.2 0 0 1-2.2-2.2z\" fill=\"#fff\"/><circle cx=\"33.2\" cy=\"33.2\" r=\"4.4\" fill=\"#fff\"/><circle cx=\"33.4\" cy=\"33\" r=\"2\" fill=\"#f7941d\"/></svg>';

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
    setSession(email) { store.set("ff_session", email); if (!email) store.set("ff_auth", null); },
    /* Supabase Auth tokens. Kept separate from the member cache so logging
       out always drops them, and so nothing password-like is ever stored. */
    auth() { return store.get("ff_auth", null); },
    setAuth(session) {
      if (!session || !session.access_token) return store.set("ff_auth", null);
      store.set("ff_auth", {
        accessToken: session.access_token,
        refreshToken: session.refresh_token || null,
        userId: (session.user && session.user.id) || null,
        email: (session.user && session.user.email) || null,
        expiresAt: Date.now() + (Number(session.expires_in || 3600) - 60) * 1000,
      });
    },
    campaigns() { return store.get("ff_campaigns", []); },
    saveCampaigns(c) { store.set("ff_campaigns", c); },
    doneMap() { return store.get("ff_done", {}); },
    saveDoneMap(d) { store.set("ff_done", d); },
    campSubs() { return store.get("ff_camp_subs", []); },
    saveCampSubs(s) { store.set("ff_camp_subs", s); },
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

  function addCampaign(campaign) {
    const all = DB.campaigns();
    const existingIndex = all.findIndex((c) => c.id === campaign.id);
    if (existingIndex > -1) {
      all[existingIndex] = Object.assign({}, all[existingIndex], campaign);
    } else {
      all.unshift(campaign);
    }
    DB.saveCampaigns(all);
  }

  function updateCampaign(id, patch) {
    const all = DB.campaigns();
    const i = all.findIndex((c) => c.id === id);
    if (i > -1) {
      all[i] = Object.assign({}, all[i], patch);
      DB.saveCampaigns(all);
    }
  }

  function deleteCampaign(id) {
    const all = DB.campaigns().filter((c) => c.id !== id);
    DB.saveCampaigns(all);
  }

  /* ---------- point-campaign proof review (Earn Points page) ----------
     A real, user-posted campaign (add.html) only pays out once its owner
     reviews and approves the worker's proof — no auto-credit on click. */
  function campId(prefix) {
    const bytes = new Uint32Array(2);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else { bytes[0] = Date.now(); bytes[1] = Math.floor(Math.random() * 1e9); }
    return (prefix || "cs") + "_" + Array.from(bytes).map((n) => n.toString(36)).join("");
  }

  function campSubsFor(campaignId) { return DB.campSubs().filter((s) => s.campaignId === campaignId); }
  function myCampSubs(email) { return DB.campSubs().filter((s) => s.worker === email); }

  function submitCampaignProof(email, name, campaignId, proof, note) {
    const camp = DB.campaigns().find((c) => c.id === campaignId);
    if (!camp) throw new Error("Campaign not found");
    if (camp.active === false) throw new Error("This campaign is paused");
    if (camp.authorEmail && camp.authorEmail === email) throw new Error("You cannot complete your own campaign");
    const already = DB.campSubs().some((s) => s.campaignId === campaignId && s.worker === email && s.status !== "rejected");
    if (already) throw new Error("You already submitted this campaign");
    if (!proof || proof.trim().length < 3) throw new Error("Add proof (link, username or screenshot URL)");
    const sub = {
      id: campId("csub"), campaignId, campaignTitle: camp.title || camp.user,
      worker: email, workerName: name || email.split("@")[0],
      owner: camp.authorEmail || "", payout: Number(camp.payout || 0),
      proof: proof.trim(), note: (note || "").trim(), status: "pending", at: Date.now(),
    };
    const all = DB.campSubs(); all.unshift(sub); DB.saveCampSubs(all);
    return sub;
  }

  function reviewCampaignSub(subId, approve, reason) {
    const all = DB.campSubs();
    const i = all.findIndex((s) => s.id === subId);
    if (i < 0) throw new Error("Submission not found");
    const s = all[i];
    if (s.status !== "pending") throw new Error("Already reviewed");
    if (approve && s.owner) {
      const owner = currentUser() && currentUser().email === s.owner ? currentUser() : DB.users().find((u) => u.email === s.owner);
      if (!owner || (owner.credits || 0) < s.payout) throw new Error("Not enough points in your balance to pay this reward");
    }

    s.status = approve ? "approved" : "rejected";
    s.reason = reason || "";
    s.reviewedAt = Date.now();

    if (approve) {
      if (s.owner) spendCredits(s.owner, s.payout, 'Paid ' + s.workerName + ' for "' + s.campaignTitle + '"');
      awardCredits(s.worker, s.payout, 'Campaign approved: "' + s.campaignTitle + '"');
      const dm = DB.doneMap();
      dm[s.worker] = dm[s.worker] || [];
      if (!dm[s.worker].includes(s.campaignId)) dm[s.worker].push(s.campaignId);
      DB.saveDoneMap(dm);
      const camps = DB.campaigns();
      const c = camps.find((x) => x.id === s.campaignId);
      if (c) {
        c.actions = (c.actions || 0) + 1;
        c.spent = (c.spent || 0) + s.payout;
        DB.saveCampaigns(camps);
      }
    }
    DB.saveCampSubs(all);
    return s;
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
    const id = memberId || makeLocalMemberId();
    return {
      name,
      email,
      memberId: id,
      credits: 25,
      earned: 25,
      spent: 0,
      refCode: "FF-" + (String(id).replace(/[^a-z0-9]/gi, "").toUpperCase() + "FLEXFAM").slice(0, 8),
      joined: Date.now(),
      activity: [{ type: "earn", text: "Welcome bonus — glad to have you on FlexFam!", amount: 25, at: Date.now() }],
      campaigns: [],
      weekly: [42, 68, 55, 90, 74, 110, 96],
    };
  }

  function rememberMember(name, email, memberId, opts) {
    const users = DB.users();
    const i = users.findIndex((u) => u.email === email);
    if (i === -1) {
      const member = defaultMember(name || email.split("@")[0], email, memberId);
      /* A brand-new local record created by a LOGIN (not a signup) gets no
         welcome bonus — the member already has an account, and their real
         balance arrives from the server on the first sync. Without this,
         every extra browser/device added a phantom +25 points. */
      if (opts && opts.welcome === false) {
        member.credits = 0;
        member.earned = 0;
        member.spent = 0;
        member.activity = [];
      }
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
      const ref = pendingRefCode();
      if (ref) { recordLocalReferral(ref, email, name); clearPendingRef(); }
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
    const refCode = pendingRefCode();
    return authRequest("/auth/v1/signup", {
      body: { email, password, data: { display_name: name, ref_code: refCode || null } },
    }).then((result) => {
      if (!result.user || !result.user.id) throw new Error("The account could not be created. Please try again.");
      const member = rememberMember(name, email, result.user.id);
      if (refCode) { recordLocalReferral(refCode, email, name); clearPendingRef(); }
      if (result.session) {
        DB.setAuth(result.session); DB.setSession(email);
        return { member, confirmationRequired: false, localOnly: false };
      }
      // No session returned (email confirmation may be on) — log the user in
      // right away so signup goes straight to a welcome + dashboard.
      return loginMember(email, password)
        .then(() => ({ member, confirmationRequired: false, localOnly: false }))
        .catch(() => ({ member, confirmationRequired: false, localOnly: false }));
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
      const member = rememberMember(profileName || email.split("@")[0], email, result.user.id, { welcome: false });
      DB.setAuth(result);
      DB.setSession(email);
      return member;
    }).catch((error) => {
      /* Existing demo/local accounts remain usable after this secure upgrade. */
      const cached = DB.users().find((u) => u.email === email);
      if (cached && (cached.passwordDigest || cached.pass)) return localLogin(email, password);
      throw error;
    });
  }

  /* ---------- Supabase RPC (server-authoritative features) ----------
     Any feature that must not be editable from the browser console (cloud
     mining balances, contracts, payouts) goes through a Postgres function
     instead of localStorage. If Supabase is not configured, or the member
     signed in with the local fallback, hasServer() is false and the caller
     falls back to the browser-only simulation. */

  /* Each browser tab gets an id so cross-tab refresh locking works. */
  const AUTH_TAB_ID = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Supabase refresh tokens are single-use (they rotate on every refresh).
     When two tabs refreshed at the same moment, one tab received the new
     token while the other got "refresh token already used" — and that tab
     silently wiped the session, dropping the member into local mode where
     campaigns, tasks and the wallet stop syncing. The losing tab now waits
     and reuses the winner's fresh session. */
  function waitForAuthRefresh(oldAuth) {
    return new Promise((resolve) => {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const fresh = DB.auth();
        const lock = store.get("ff_auth_refresh", null);
        const lockActive = lock && lock.by !== AUTH_TAB_ID && (Date.now() - (lock.at || 0)) < 8000;
        if (fresh && fresh.accessToken && fresh.accessToken !== oldAuth.accessToken) {
          clearInterval(timer); resolve(fresh);
        } else if (!lockActive || tries >= 45) {
          clearInterval(timer); resolve(refreshAuth(true));
        }
      }, 200);
    });
  }

  function refreshAuth(skipLock) {
    const auth = DB.auth();
    const cfg = memberConfig();
    if (!cfg || !auth || !auth.refreshToken) return Promise.resolve(null);
    if (!skipLock) {
      const lock = store.get("ff_auth_refresh", null);
      if (lock && lock.by !== AUTH_TAB_ID && Date.now() - (lock.at || 0) < 8000) {
        return waitForAuthRefresh(auth);
      }
    }
    store.set("ff_auth_refresh", { at: Date.now(), by: AUTH_TAB_ID });
    return authRequest("/auth/v1/token?grant_type=refresh_token", {
      body: { refresh_token: auth.refreshToken },
    }).then((result) => {
      store.set("ff_auth_refresh", null);
      if (!result || !result.access_token) throw new Error("Session expired — please log in again");
      DB.setAuth(result);
      return DB.auth();
    }).catch(() => {
      store.set("ff_auth_refresh", null);
      /* Another tab may have rotated the token a heartbeat ago — reuse its
         session instead of logging the member out. */
      const fresh = DB.auth();
      if (fresh && fresh.accessToken && fresh.accessToken !== auth.accessToken) return fresh;
      DB.setAuth(null);
      return null;
    });
  }

  function accessToken() {
    const auth = DB.auth();
    if (!auth) return Promise.resolve(null);
    if (auth.expiresAt && auth.expiresAt > Date.now()) return Promise.resolve(auth.accessToken);
    return refreshAuth().then((fresh) => (fresh ? fresh.accessToken : null));
  }

  function hasServer() {
    const u = currentUser();
    return !!(memberConfig() && DB.auth() && u && DB.auth().email &&
              String(DB.auth().email).toLowerCase() === String(u.email).toLowerCase());
  }

  /* Calls a Postgres function. Rejects with err.offline = true when the
     member has no server session, so callers can degrade gracefully. */
  function rpc(fn, args) {
    const cfg = memberConfig();
    if (!cfg) {
      const e = new Error("Server features are not configured on this deployment");
      e.offline = true;
      return Promise.reject(e);
    }
    return accessToken().then((token) => {
      if (!token) {
        const e = new Error("Please log in again to sync with the server");
        e.offline = true;
        throw e;
      }
      return fetch(String(cfg.url).replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: {
          apikey: cfg.anonKey,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args || {}),
      }).then((res) => res.text().then((text) => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          const msg = (json && (json.message || json.hint || json.error_description || json.error)) ||
            "Request failed (" + res.status + ")";
          const err = new Error(msg);
          /* 401/403 = the session died; let the caller fall back locally. */
          if (res.status === 401 || res.status === 403) err.offline = true;
          throw err;
        }
        return json;
      }));
    });
  }

  /* ---------- purge legacy seeded/demo campaigns ----------
     Earlier builds injected randomly-generated "genesis" campaigns and a
     handful of hardcoded extras (bot-start, website-visit, etc.) directly
     into ff_campaigns so the Earn page never looked empty. Those were fake,
     unowned listings with no real advertiser behind them. Strip them out on
     load so the Earn page only ever shows campaigns real users created via
     add.html. This runs once per browser (flagged by ff_demo_campaigns_purged)
     and is safe to re-run. */
  function purgeSeedCampaigns() {
    if (store.get("ff_demo_campaigns_purged", 0) >= 1) return;
    const real = DB.campaigns().filter((c) => c && c.mine === true && c.authorEmail);
    DB.saveCampaigns(real);
    store.set("ff_demo_campaigns_purged", 1);
  }


  /* ---------- referrals ----------
     A referral only counts when somebody SIGNS UP through the link. The
     pending code is captured from ?ref= / #r/CODE on any page and consumed
     by signupMember(). In server mode the database records it (see
     supabase-community.sql); locally we keep a mirror in ff_referrals. */
  const REF_PENDING = "ff_ref_pending";

  function refCodeFor(user) {
    if (!user) return "";
    if (user.refCode && /^FF-/.test(user.refCode)) return user.refCode;
    const seed = String(user.memberId || user.email || "member").replace(/[^a-z0-9]/gi, "").toUpperCase();
    return "FF-" + (seed + "FLEXFAM").slice(0, 8);
  }

  function refLink(user) {
    const base = location.origin && location.origin !== "null"
      ? location.origin + location.pathname.replace(/[^/]*$/, "")
      : "https://flexfam.io/";
    return base + "signup.html?ref=" + encodeURIComponent(refCodeFor(user));
  }

  function captureRefCode() {
    let code = "";
    try {
      const p = new URLSearchParams(location.search);
      code = p.get("ref") || p.get("r") || "";
      if (!code) {
        const m = /(?:^#\/?r\/|^#ref=)([A-Za-z0-9-]+)/.exec(location.hash || "");
        if (m) code = m[1];
      }
    } catch (e) {}
    code = String(code || "").trim().toUpperCase();
    if (code) store.set(REF_PENDING, code);
    return store.get(REF_PENDING, "");
  }

  function pendingRefCode() { return String(store.get(REF_PENDING, "") || "").toUpperCase(); }
  function clearPendingRef() { store.set(REF_PENDING, ""); }

  function localReferrals() { return store.get("ff_referrals", []); }

  function recordLocalReferral(code, newEmail, newName) {
    if (!code) return;
    const owner = DB.users().find((u) => refCodeFor(u).toUpperCase() === code.toUpperCase());
    if (!owner || owner.email === newEmail) return;
    const all = localReferrals();
    if (all.some((r) => r.referred === newEmail)) return;
    all.unshift({ code: code.toUpperCase(), owner: owner.email, referred: newEmail, name: newName || newEmail.split("@")[0], at: Date.now() });
    store.set("ff_referrals", all);
  }

  /* { code, link, count, recent[] } for the current member. */
  function referralStats() {
    const u = currentUser();
    if (!u) return { code: "", link: "", count: 0, recent: [] };
    const mine = localReferrals().filter((r) => r.owner === u.email);
    return {
      code: refCodeFor(u),
      link: refLink(u),
      count: mine.length,
      recent: mine.slice(0, 20),
    };
  }

  /* Pull the authoritative referral stats when Supabase is configured. */
  function loadReferralStats() {
    const local = referralStats();
    if (!hasServer()) return Promise.resolve(local);
    return rpc("referral_stats").then((r) => {
      if (!r) return local;
      const code = r.code || local.code;
      return {
        code,
        link: local.link.replace(/ref=[^&]*/, "ref=" + encodeURIComponent(code)),
        count: Number(r.count || 0),
        recent: (r.recent || []).map((x) => ({ name: x.name, at: Number(x.at) })),
      };
    }).catch(() => local);
  }

  /* ---------- member messages (admin broadcast / DM) ---------- */
  function localMessages() { return store.get("ff_messages", []); }

  function inboxMessages() {
    const u = currentUser();
    if (!u) return [];
    const reads = store.get("ff_msg_reads", {})[u.email] || [];
    return localMessages()
      .filter((m) => m.audience === "all" || String(m.to || "").toLowerCase() === u.email)
      .map((m) => Object.assign({}, m, { read: reads.indexOf(m.id) > -1 }))
      .sort((a, b) => b.at - a.at);
  }

  function loadInbox() {
    if (!hasServer()) return Promise.resolve(inboxMessages());
    return rpc("messages_inbox").then((rows) => (rows || []).map((m) => ({
      id: m.id, title: m.title, body: m.body, audience: m.audience,
      at: Number(m.at), read: !!m.read,
    }))).catch(() => inboxMessages());
  }

  function markInboxRead() {
    const u = currentUser();
    if (u) {
      const all = store.get("ff_msg_reads", {});
      all[u.email] = inboxMessages().map((m) => m.id);
      store.set("ff_msg_reads", all);
    }
    if (!hasServer()) return Promise.resolve(inboxMessages());
    return rpc("messages_mark_read").then((rows) => (rows || []).map((m) => ({
      id: m.id, title: m.title, body: m.body, audience: m.audience,
      at: Number(m.at), read: !!m.read,
    }))).catch(() => inboxMessages());
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
      credits: Math.max(0, user.credits - amount),
      spent: (user.spent || 0) + amount,
    };
    patch.activity = addActivity(Object.assign({}, user, patch), "spend", text, -amount);
    updateUser(email, patch);
    syncCreditPills();
    return true;
  }

  function syncCreditPills() {
    const u = currentUser();
    const count = u ? Number(u.credits || 0).toLocaleString("en-IN") : "0";
    document.querySelectorAll("[data-credits]").forEach((el) => {
      el.textContent = count;
    });
  }

  /* ---------- toast ---------- */
  function toast(msg, kind) {
    const icons = { ok: CHECK_SVG, err: WARN_SVG, info: SPARK_SVG };
    kind = icons[kind] ? kind : "info";

    let root = document.querySelector(".toast-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "toast-root";
      root.setAttribute("aria-live", "polite");
      root.setAttribute("aria-atomic", "false");
      document.body.appendChild(root);
    }

    const el = document.createElement("div");
    el.className = "toast " + kind;
    if (kind === "err") el.setAttribute("role", "alert");

    const icon = document.createElement("span");
    icon.className = "t-ic";
    /* The SVGs above are fixed application markup; message text is never HTML. */
    icon.innerHTML = icons[kind];

    const text = document.createElement("span");
    text.className = "toast-message";
    text.textContent = String(msg == null || msg === "" ? "Something went wrong" : msg);

    el.append(icon, text);
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
    for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function initials(name) {
    return (name || "Flexer").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "FF";
  }

  /* ---------- header + nav ---------- */
  function initHeader() {
    const head = document.querySelector(".site-head");
    if (!head) return;
    let ticking = false, scrolled = null;
    const apply = () => {
      ticking = false;
      const next = window.scrollY > 15;
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
      burger.setAttribute("aria-expanded", "false");
      mnav.setAttribute("aria-hidden", "true");

      const toggleNav = (forceState) => {
        const isOpen = forceState !== undefined ? forceState : !mnav.classList.contains("open");
        burger.classList.toggle("open", isOpen);
        mnav.classList.toggle("open", isOpen);
        burger.setAttribute("aria-expanded", String(isOpen));
        mnav.setAttribute("aria-hidden", String(!isOpen));
        document.body.style.overflow = isOpen ? "hidden" : "";
      };
      burger.addEventListener("click", () => toggleNav());
      mnav.querySelectorAll("a").forEach((a) =>
        a.addEventListener("click", () => {
          toggleNav(false);
        })
      );
      document.addEventListener("click", (e) => {
        if (mnav.classList.contains("open") && !mnav.contains(e.target) && !burger.contains(e.target)) {
          toggleNav(false);
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && mnav.classList.contains("open")) {
          toggleNav(false);
          burger.focus();
        }
      });
      window.addEventListener("resize", () => {
        if (window.innerWidth > 1024 && mnav.classList.contains("open")) {
          toggleNav(false);
        }
      });
    }
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal() {
    const reveals = document.querySelectorAll(".reveal");
    if (!reveals.length) return;
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.06, rootMargin: "0px 0px -20px 0px" }
      );
      reveals.forEach((el) => io.observe(el));
    } else {
      reveals.forEach((el) => el.classList.add("in"));
    }
  }

  /* ---------- counters ---------- */
  function initCounters() {
    const els = document.querySelectorAll("[data-count]");
    if (!els.length) return;
    const runCounter = (el) => {
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      const dur = 1400;
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        el.textContent = (target % 1 !== 0 ? val.toFixed(1) : Math.floor(val).toLocaleString("en-IN")) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            io.unobserve(e.target);
            runCounter(e.target);
          });
        },
        { threshold: 0.1 }
      );
      els.forEach((el) => io.observe(el));
    } else {
      els.forEach(runCounter);
    }
  }

  /* ---------- hero tilt ---------- */
  function initTilt() {
    const card = document.querySelector("[data-tilt]");
    if (!card || window.matchMedia("(pointer: coarse)").matches) return;
    let rafId = 0, mx = 0, my = 0;
    const paint = () => {
      rafId = 0;
      card.style.transform = `perspective(900px) rotateY(${mx * 8}deg) rotateX(${-my * 8}deg) translateZ(6px)`;
    };
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      mx = Math.max(-0.5, Math.min(0.5, (e.clientX - rect.left) / rect.width - 0.5));
      my = Math.max(-0.5, Math.min(0.5, (e.clientY - rect.top) / rect.height - 0.5));
      if (!rafId) rafId = requestAnimationFrame(paint);
    }, { passive: true });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg) translateZ(0)";
    });
  }

  /* ---------- activity ticker ---------- */
  const TICKER_ITEMS = [
    '<b>@aaravshots</b> started <b>FlexFam Rewards Bot (@sub_for_sub_bot)</b> on Telegram &amp; earned <b>+15</b> points',
    '<b>@techguru.reels</b> launched a new campaign for <b>YouTube</b> · <b>6</b> pts/sub',
    '<b>@desifoodies</b> completed a <b>Website Visit</b> task &amp; earned <b>+6</b> points',
    '<b>@kavyacreates</b> followed <b>@melodymaya</b> on Instagram &amp; earned <b>+3</b> points',
    '<b>@urbanbeatz</b> joined <b>Crypto Charcha</b> Telegram channel &amp; earned <b>+6</b> points',
    '<b>@fitwithsimran</b> claimed daily check-in bonus &amp; earned <b>+8</b> points',
    '<b>@nehavlogs</b> boosted their TikTok video &amp; gained <b>+320</b> views',
  ];

  function initTicker() {
    const el = document.getElementById("ticker-text");
    if (!el) return;
    let idx = 0;
    el.innerHTML = TICKER_ITEMS[0];
    setInterval(() => {
      idx = (idx + 1) % TICKER_ITEMS.length;
      el.style.opacity = "0";
      setTimeout(() => {
        el.innerHTML = TICKER_ITEMS[idx];
        el.style.opacity = "1";
      }, 250);
    }, 3800);
  }

  /* ---------- auth guard ---------- */
  function guard() {
    if (document.body.hasAttribute("data-requires-auth")) {
      const u = currentUser();
      if (!u) {
        const page = location.pathname.split("/").pop() || "dashboard.html";
        window.location.href = "login.html?next=" + encodeURIComponent(page);
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
          toast("Welcome to FlexFam, " + name.split(" ")[0] + "! Account created 🎉 +25 welcome points", "ok");
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
    const demoBtns = document.querySelectorAll("#demo-login, [data-demo-login]");
    demoBtns.forEach((demoBtn) => {
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
          delete demo.pass;
          DB.saveUsers(users);
        }
        DB.setSession("demo@flexfam.io");
        toast("Logged into the demo account!", "ok");
        setTimeout(() => (window.location.href = "dashboard.html"), 700);
      });
    });

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
    /* swap auth buttons & nav links based on login state */
    if (u) {
      document.querySelectorAll("[data-guest-only]").forEach((el) => el.classList.add("hidden"));
      document.querySelectorAll("[data-user-only]").forEach((el) => el.classList.remove("hidden"));
    } else {
      document.querySelectorAll("[data-user-only]").forEach((el) => el.classList.add("hidden"));
      document.querySelectorAll("[data-guest-only]").forEach((el) => el.classList.remove("hidden"));
    }
  }

  function initAnimPause() {}

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    purgeSeedCampaigns();
    captureRefCode();
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

  /* ---------- SFX: coin add + USDT collect (Web Audio — koi file nahi) ---------- */
  const sfx = (() => {
    let actx = null;
    function ac() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!actx) { try { actx = new Ctx(); } catch (e) { return null; } }
      if (actx.state === "suspended") { try { actx.resume(); } catch (e) {} }
      return actx;
    }
    /* ek bell note: wave, freq, start-offset sec, decay sec, volume */
    function bell(c, wave, freq, at, dur, vol) {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + at;
      o.type = wave;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
    return {
      /* points credited — bright coin "bling" (B5 → E6) */
      coin() {
        try {
          const c = ac(); if (!c) return;
          bell(c, "triangle", 987.77, 0, 0.55, 0.20);
          bell(c, "sine", 1975.53, 0, 0.40, 0.06);
          bell(c, "triangle", 1318.51, 0.08, 0.65, 0.20);
          bell(c, "sine", 2637.02, 0.08, 0.48, 0.06);
        } catch (e) { /* sound optional */ }
      },
      /* USDT collect — "ka-ching!" + rising win chime */
      cash() {
        try {
          const c = ac(); if (!c) return;
          bell(c, "triangle", 987.77, 0, 0.30, 0.20);   /* ka */
          bell(c, "triangle", 1318.51, 0.09, 0.40, 0.22); /* ching */
          bell(c, "sine", 1567.98, 0.19, 1.00, 0.11);   /* G6 bell */
          bell(c, "sine", 2093.00, 0.26, 1.05, 0.10);   /* C7 bell */
          bell(c, "sine", 2637.02, 0.33, 1.05, 0.07);   /* E7 bell */
          bell(c, "sine", 3135.96, 0.40, 0.95, 0.05);   /* G7 sparkle */
        } catch (e) { /* sound optional */ }
      },
    };
  })();

  /* expose */
  window.FF = {
    PLATFORMS, BRAND_SVG, COIN_SVG, SPARK_SVG, CHECK_SVG,
    sfx,
    store, DB, currentUser, updateUser, memberConfig,
    rpc, hasServer, accessToken, refreshAuth,
    loginMember, signupMember,
    addCampaign, updateCampaign, deleteCampaign,
    awardCredits, spendCredits, syncCreditPills,
    refCodeFor, refLink, referralStats, loadReferralStats, pendingRefCode, captureRefCode,
    inboxMessages, loadInbox, markInboxRead,
    campSubsFor, myCampSubs, submitCampaignProof, reviewCampaignSub,
    toast, avatarColor, initials,
  };
})();
