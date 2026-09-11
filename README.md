# FlexFam 🚀

**FlexFam** is a free social-exchange platform (like YouLikeHits) — earn points, grow your social pages, grow your fam.

## Features

- 🏠 **Landing page** — animated hero, live ticker, platform marquee, testimonials, pricing
- 💰 **Earn Points** — tasks across 8 platforms: **Telegram**, YouTube, Instagram, TikTok, X, Facebook, Twitch, Pinterest
- 📣 **Add Page** — launch your campaigns, payout slider (1–20 points/action)
- 📊 **Dashboard** — stats, weekly chart, campaign pause/delete, referral system, activity feed
- 🔐 **Auth** — signup/login (localStorage mock backend) + one-click demo account
- 🤖 **Telegram Sub4Sub Bot** — real, fully-working bot: users join each other's Telegram groups to earn points, then spend them to grow their own groups (SQLite, auto join-verification, anti-leave refunds, referrals, admin panel). See [`telegram-bot/`](telegram-bot/)
- 🎨 Premium dark UI — aurora gradients, glassmorphism, 3D tilt, scroll reveals

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

No build step — pure HTML/CSS/JS. Demo data seeds automatically.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
