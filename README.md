# FlexFam 🚀

**FlexFam** is a free social-exchange platform (like YouLikeHits) — earn points from social tasks, Telegram bot starts and website visits, then grow your pages/fam.

## Features

- 🏠 **Landing page** — performance-first hero, readable point metrics, platform list, testimonials, pricing
- 💰 **Earn Points** — tasks across 9 modes: **Telegram** (incl. Bot Start), Website Visits, YouTube, Instagram, TikTok, X, Facebook, Twitch, Pinterest
- 📣 **Add Page** — launch your campaigns, payout slider (1–20 points/action)
- 📊 **Dashboard** — high-contrast stats, weekly chart, campaign pause/delete, referral system, new earning modes, activity feed
- 🔐 **Auth** — Supabase email signup/login when configured; raw passwords stay in Supabase Auth and are never stored in browser data. A browser-only hashed fallback and one-click demo account keep local previews usable.
- 📈 **Admin panel** — `admin.html` with Supabase Auth login + permanent Postgres analytics and a protected registered-accounts list (account ID, display name, email, signup time, JSON export; never passwords)
- 🤖 **Telegram Sub4Sub Bot** — real, fully-working bot: users join each other's Telegram groups to earn points, then spend them to grow their own groups (SQLite, auto join-verification, anti-leave refunds, referrals, admin panel). See [`telegram-bot/`](telegram-bot/)
- 🎨 Premium dark UI — aurora gradients, glassmorphism, 3D tilt, scroll reveals

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — pure HTML/CSS/JS. Demo data seeds automatically, including Telegram Bot Start and Website Visit tasks.

## Admin panel + permanent analytics (Supabase)

The static site stores global analytics and member identities in Supabase. Copy `assets/js/supabase-config.example.js` to `assets/js/supabase-config.js`, add your project URL, anon key, and admin email, then run [`supabase.sql`](supabase.sql) **as one script** in the Supabase SQL editor. Enable Email auth and create the admin user in Supabase Authentication.

The SQL migration creates a database trigger for new Supabase Auth users. It records only their account ID, display name, email and signup time in `public.profiles`; the profiles table can only be read by an allowlisted admin. Passwords remain in Supabase Auth, are not copied to Postgres/browser storage, and cannot be viewed or exported from `admin.html`.

Tracked events include page views, external links, Telegram bot clicks, task opens/claims, and campaign creation. RLS permits anonymous analytics inserts; the dashboard's analytics and member list have admin-only SELECT policies. The anon key is safe for browser use, but never expose a service-role key.

If the config is missing or still has placeholders, tracking is disabled and `admin.html` shows setup instructions.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
