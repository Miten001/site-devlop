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
- 💵 **USDT Task Marketplace** — `tasks.html` (browse & work), `post-task.html` (publish jobs with escrow), `my-tasks.html` (review proofs, release payments, cancel & refund). 8 categories, per-task rewards, worker slots, proof review workflow. **No sample listings — the market only shows real, user-posted and escrow-funded tasks**
- 🏦 **USDT Wallet** — `wallet.html` with deposit (USDT on BEP20, min $10, live QR code + TXID submission), withdrawal requests (BEP20 only, min $5, 1% fee), points→USDT conversion (1000 pts = $1) and a full transaction ledger
- 🛡️ **Payments admin** — `admin-payments.html` for allowlisted admins to approve/reject deposits and withdrawals
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

## USDT wallet & task marketplace

The USDT marketplace ships **empty on purpose**: no demo or placeholder tasks are injected, so every listing a visitor sees is a real job funded by a real user. (`FF.W.purgeDemoData()` clears sample listings left in `localStorage` by earlier builds.)

Money flow is currently a **front-end simulation** stored in `localStorage` (`ff_wallets`, `ff_pay_requests`, `ff_jobs`, `ff_job_subs`) and implemented in [`assets/js/wallet.js`](assets/js/wallet.js).

| Setting | Value | Where |
| --- | --- | --- |
| Min deposit | $10 | `FF.W.CFG.minDeposit` |
| Min withdrawal | $5 | `FF.W.CFG.minWithdraw` |
| Withdrawal fee | 1% | `FF.W.CFG.withdrawFeePct` |
| Platform fee (task creators) | 5% | `FF.W.CFG.platformFeePct` |
| Points → USDT | 1000 pts = $1 | `FF.W.CFG.pointsPerUsdt` |
| Deposit network | BEP20 (BNB Smart Chain) only | `FF.W.CFG.networks` |
| Deposit address | `0xe85d1b6b330219de89e826f314a9bc2bcd595e53` | `FF.W.CFG.depositAddress` |
| Withdrawal networks | BEP20 (BNB Smart Chain) only | `FF.W.CFG.withdrawNetworks` |

Deposits currently accept **USDT on BEP20 only**, to the verified address above (QR at `assets/img/deposit-bep20-qr.png`). To support another chain, add a real verified address to `depositAddress`, a note to `networkNote`, a QR to `depositQr`, and list it in `networks` — never ship a placeholder address. **Before going live** move deposits, withdrawals and escrow settlement onto a server/Postgres so balances cannot be edited from the browser console.

Admins listed in `window.FF_ADMIN_EMAILS` can settle payment requests at `admin-payments.html`.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
