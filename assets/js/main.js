/* ============================================================
   FLEXFAM — shared engine
   localStorage mock backend: users, session, campaigns, credits
   ============================================================ */

(function () {
  "use strict";

  /* ---------- platform registry ---------- */
  const PLATFORMS = {
    telegram: {
      key: "telegram",
      name: "Telegram",
      color: "#2aabee",
      actions: ["Join Channel", "Join Group", "Boost Post"],
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

  function seedCampaigns() {
    if (store.get("ff_seeded", false)) return;
    const keys = Object.keys(PLATFORMS);
    const list = [];
    const rnd = seededRand("flexfam-genesis");
    let id = 1;
    keys.forEach((pk) => {
      const p = PLATFORMS[pk];
      const per = pk === "telegram" ? 4 : 3;
      for (let i = 0; i < per; i++) {
        const name = SEED_NAMES[Math.floor(rnd() * SEED_NAMES.length)];
        const action = p.actions[Math.floor(rnd() * p.actions.length)];
        const payout = [8, 10, 12, 15, 18, 20, 25][Math.floor(rnd() * 7)];
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const urls = {
          telegram: "https://t.me/" + slug,
          youtube: "https://youtube.com/@" + slug,
          instagram: "https://instagram.com/" + slug,
          x: "https://x.com/" + slug,
          tiktok: "https://tiktok.com/@" + slug,
          facebook: "https://facebook.com/" + slug,
          twitch: "https://twitch.tv/" + slug,
          pinterest: "https://pinterest.com/" + slug,
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
    DB.saveCampaigns(list);
    store.set("ff_seeded", true);
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
    const onScroll = () => head.classList.toggle("scrolled", window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

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
    wrap.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = "rotateY(" + x * 10 + "deg) rotateX(" + -y * 10 + "deg)";
    });
    wrap.addEventListener("mouseleave", () => { card.style.transform = "rotateY(0) rotateX(0)"; });
  }

  /* ---------- live activity ticker ---------- */
  function initTicker() {
    const el = document.getElementById("ticker-text");
    if (!el) return;
    const rows = [
      '<b>@aaravshots</b> joined <b>UrbanBeatz</b> Telegram channel & earned <b>+15</b> credits',
      '<b>@nehavlogs</b> subscribed <b>TechGuru Rohan</b> on YouTube & earned <b>+18</b> credits',
      '<b>@melodymaya</b> followed <b>GameLordYT</b> on Instagram & earned <b>+12</b> credits',
      '<b>@pixelninja</b> joined <b>Crypto Charcha</b> Telegram group & earned <b>+20</b> credits',
      '<b>@desifoodies</b> reposted <b>CricketFever</b> on X & earned <b>+10</b> credits',
      '<b>@kwavya</b> promoted her TikTok for <b>500</b> credits',
      '<b>@coderkibaatein</b> added a new Telegram channel campaign',
      '<b>@traveltales</b> liked a Facebook page & earned <b>+8</b> credits',
    ];
    let i = 0;
    const swap = () => {
      el.style.transition = "opacity .35s, transform .35s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(() => {
        el.innerHTML = rows[i % rows.length];
        i++;
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, 380);
    };
    el.innerHTML = rows[0];
    i = 1;
    setInterval(swap, 3400);
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
        const name = signupForm.name.value.trim();
        const email = signupForm.email.value.trim().toLowerCase();
        const pass = signupForm.password.value;
        if (name.length < 2) return toast("Apna naam likhiye (min 2 characters)", "err");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Valid email daaliye", "err");
        if (pass.length < 6) return toast("Password kam se kam 6 characters ka ho", "err");
        const users = DB.users();
        if (users.some((u) => u.email === email)) return toast("Ye email pehle se registered hai — login karo", "err");
        users.push({
          name, email, pass,
          credits: 300, earned: 300, spent: 0,
          refCode: "FF-" + name.replace(/\s+/g, "").slice(0, 4).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000),
          joined: Date.now(),
          activity: [{ type: "earn", text: "Welcome bonus — FlexFam me aapka swagat hai!", amount: 300, at: Date.now() }],
          campaigns: [],
          weekly: [42, 68, 55, 90, 74, 110, 96],
        });
        DB.saveUsers(users);
        DB.setSession(email);
        toast("Account ban gaya! +300 welcome credits", "ok");
        setTimeout(() => (window.location.href = "dashboard.html"), 900);
      });
    }

    const loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = loginForm.email.value.trim().toLowerCase();
        const pass = loginForm.password.value;
        const user = DB.users().find((u) => u.email === email && u.pass === pass);
        if (!user) return toast("Email ya password galat hai", "err");
        DB.setSession(email);
        toast("Wapas aagaye, " + user.name.split(" ")[0] + "!", "ok");
        const params = new URLSearchParams(location.search);
        setTimeout(() => (window.location.href = params.get("next") || "dashboard.html"), 800);
      });
    }

    /* demo one-click login */
    const demoBtn = document.getElementById("demo-login");
    if (demoBtn) {
      demoBtn.addEventListener("click", () => {
        const users = DB.users();
        let demo = users.find((u) => u.email === "demo@flexfam.io");
        if (!demo) {
          demo = {
            name: "Demo Star", email: "demo@flexfam.io", pass: "demo",
            credits: 1240, earned: 3870, spent: 2630,
            refCode: "FF-DEMO-2025", joined: Date.now(),
            activity: [
              { type: "earn", text: 'Joined "UrbanBeatz" Telegram channel', amount: 15, at: Date.now() - 1000 * 60 * 8 },
              { type: "earn", text: 'Subscribed "TechGuru Rohan" on YouTube', amount: 18, at: Date.now() - 1000 * 60 * 26 },
              { type: "spend", text: 'Promoted "Demo Star" Instagram page', amount: -120, at: Date.now() - 1000 * 60 * 70 },
              { type: "earn", text: 'Followed "MelodyMaya" on Instagram', amount: 12, at: Date.now() - 1000 * 60 * 130 },
            ],
            campaigns: [
              { id: "m1", platform: "telegram", title: "Demo Star Official", url: "https://t.me/demostar", payout: 12, active: true, actions: 48, spent: 576 },
              { id: "m2", platform: "instagram", title: "@demostar", url: "https://instagram.com/demostar", payout: 10, active: true, actions: 63, spent: 630 },
            ],
            weekly: [42, 68, 55, 90, 74, 110, 96],
          };
          users.push(demo);
          DB.saveUsers(users);
        }
        DB.setSession("demo@flexfam.io");
        toast("Demo account me login ho gaya!", "ok");
        setTimeout(() => (window.location.href = "dashboard.html"), 700);
      });
    }

    /* logout links */
    document.querySelectorAll("[data-logout]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        DB.setSession(null);
        toast("Logout ho gaya. Phir milenge!", "info");
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
    store, DB, currentUser, updateUser,
    awardCredits, spendCredits, syncCreditPills,
    toast, avatarColor, initials,
  };
})();
