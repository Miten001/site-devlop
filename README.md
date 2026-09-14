# FlexFam 🚀

**FlexFam** is a free social-exchange platform (like YouLikeHits) — earn points from social tasks, Telegram bot starts and website visits, then grow your pages/fam.

## Features

- 🏠 **Landing page** — animated hero, live ticker, platform marquee, testimonials, pricing
- 💰 **Earn Points** — tasks across 9 modes: **Telegram** (incl. Bot Start), Website Visits, YouTube, Instagram, TikTok, X, Facebook, Twitch, Pinterest
- 📣 **Add Page** — launch your campaigns, payout slider (1–20 points/action)
- 📊 **Dashboard** — high-contrast stats, weekly chart, campaign pause/delete, referral system, new earning modes, activity feed
- 🔐 **Auth** — signup/login (localStorage mock backend) + one-click demo account
- 📈 **Admin panel** — `admin.html` with Supabase Auth login + permanent Postgres analytics (total/today views, unique visitors, Telegram bot clicks, task claims, top pages, referrers, recent events, JSON export)
- 🤖 **Telegram Sub4Sub Bot** — real, fully-working bot: users join each other's Telegram groups to earn points, then spend them to grow their own groups (SQLite, auto join-verification, anti-leave refunds, referrals, admin panel). See [`telegram-bot/`](telegram-bot/)
- 🎨 Premium dark UI — aurora gradients, glassmorphism, 3D tilt, scroll reveals

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — pure HTML/CSS/JS. Demo data seeds automatically, including Telegram Bot Start and Website Visit tasks.

## Admin panel + permanent analytics (Supabase)

The static site stores global analytics in Supabase Postgres. Copy `assets/js/supabase-config.example.js` to `assets/js/supabase-config.js`, add your project URL, anon key, and admin email, then run [`supabase.sql`](supabase.sql) in the Supabase SQL editor. Enable Email auth and create the admin user in Supabase Authentication.

Tracked events include page views, external links, Telegram bot clicks, task opens/claims, and campaign creation. RLS permits anonymous inserts; configure a secure admin SELECT policy for the admin dashboard. The anon key is safe for browser use, but never expose a service-role key.

If the config is missing or still has placeholders, tracking is disabled and `admin.html` shows setup instructions.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
