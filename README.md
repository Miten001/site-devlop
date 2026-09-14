# FlexFam 🚀

**FlexFam** is a free social-exchange platform (like YouLikeHits) — earn points from social tasks, Telegram bot starts and website visits, then grow your pages/fam.

## Features

- 🏠 **Landing page** — animated hero, live ticker, platform marquee, testimonials, pricing
- 💰 **Earn Points** — tasks across 9 modes: **Telegram** (incl. Bot Start), Website Visits, YouTube, Instagram, TikTok, X, Facebook, Twitch, Pinterest
- 📣 **Add Page** — launch your campaigns, payout slider (1–20 points/action)
- 📊 **Dashboard** — high-contrast stats, weekly chart, campaign pause/delete, referral system, new earning modes, activity feed
- 🔐 **Auth** — signup/login (localStorage mock backend) + one-click demo account
- 📈 **Admin panel** — `admin.html` with Firebase Auth login + permanent Firestore analytics (total/today views, unique visitors, Telegram bot clicks, task claims, top pages, referrers, recent events, JSON export)
- 🤖 **Telegram Sub4Sub Bot** — real, fully-working bot: users join each other's Telegram groups to earn points, then spend them to grow their own groups (SQLite, auto join-verification, anti-leave refunds, referrals, admin panel). See [`telegram-bot/`](telegram-bot/)
- 🎨 Premium dark UI — aurora gradients, glassmorphism, 3D tilt, scroll reveals

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — pure HTML/CSS/JS. Demo data seeds automatically, including Telegram Bot Start and Website Visit tasks.

## Admin panel + permanent analytics (Firebase / Firestore)

The site is static (GitHub Pages), so permanent, **global** analytics data lives in **Firestore** — not localStorage. Visitors can only *create* analytics events; only the allowlisted admin email can *read* them (enforced by `firestore.rules`). The Firebase web config is a public identifier, not a secret — no private keys go into the frontend.

Tracked events: `page_view`, `link_click`, `telegram_bot_click` (for `https://t.me/sub_for_sub_bot?start=web_bonus`), `task_open`, `task_claim`, `campaign_created`. Campaigns are also mirrored into a `campaigns` collection, and `users`/`points` collections are pre-declared in the rules so the localStorage mock backend can migrate later.

### Setup (one time, ~10 minutes)

1. **Create a Firebase project** — [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (Google Analytics optional).
2. **Enable Firestore** — Build → *Firestore Database* → *Create database* → Production mode → pick a region.
3. **Enable Email/Password auth** — Build → *Authentication* → *Sign-in method* → enable **Email/Password**.
4. **Create the admin user** — Authentication → *Users* → *Add user* → e.g. `admin@yourdomain.com` + strong password.
5. **Fill in the web config** — Project settings → General → *Your apps* → add a **Web app** → copy the config object, then:

   ```bash
   cp assets/js/firebase-config.example.js assets/js/firebase-config.js
   # edit assets/js/firebase-config.js:
   #   • paste your Firebase config values
   #   • set window.FF_ADMIN_EMAILS = ["admin@yourdomain.com"]
   ```

   > `assets/js/firebase-config.js` is **gitignored**. On GitHub Pages, commit it deliberately with `git add -f assets/js/firebase-config.js` (it contains only the public web config) — or add it via a deploy step.
6. **Deploy the Firestore rules** — open [`firestore.rules`](firestore.rules), replace `admin@example.com` with your admin email, then paste the whole file into Firebase Console → Firestore Database → *Rules* → **Publish** (or `firebase deploy --only firestore:rules` with the CLI).
7. **Open the admin panel** — `admin.html` → log in with the admin email/password → live stats: total views, today's views, unique visitors (approx, anonymous `ff_vid`), Telegram bot clicks, task claims, campaigns, top pages, referrers, recent events, and one-click **Export JSON**.

If `firebase-config.js` is missing or still has placeholder values, the site works exactly as before (tracking silently disabled) and `admin.html` shows setup instructions.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
