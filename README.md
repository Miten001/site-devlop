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
- 🏦 **USDT Wallet** — `wallet.html` with deposit (USDT on BEP20, min $10, live QR code + TXID submission), withdrawal requests (BEP20 only, min $5, 1% fee), points→USDT conversion (1000 pts = $1) and a full transaction ledger. Wallet, escrow and the marketplace all run on a **server-authoritative Postgres backend** ([`supabase-wallet.sql`](supabase-wallet.sql))
- ⛏️ **Cloud Mining** — `mining.html`: rent hashrate with **points or USDT**, rigs mine 24/7 (rewards accrue even while offline), free daily +25% boost, claim mined USDT to the wallet or as points with a +10% bonus. Ships with a **server-authoritative Postgres backend** ([`supabase-mining.sql`](supabase-mining.sql)) so balances cannot be edited from the browser console
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

Like mining, the wallet runs in one of **two modes**. With Supabase configured and a signed-in member, balances, escrow and every payout live in Postgres ([`supabase-wallet.sql`](supabase-wallet.sql)) and cannot be edited from the browser console. Without a session it falls back to the `localStorage` simulation in [`assets/js/wallet.js`](assets/js/wallet.js) (`ff_wallets`, `ff_pay_requests`, `ff_jobs`, `ff_job_subs`) so local previews and the demo account keep working. `wallet.html` shows which mode is live via the **Balance mode** pill.

| | Browser mode | **Server mode (recommended)** |
| --- | --- | --- |
| State lives in | `localStorage` | Postgres, in your Supabase project |
| Can a user edit their balance from devtools? | **Yes** | **No** |
| Needs setup | none | run [`supabase-wallet.sql`](supabase-wallet.sql) |

In server mode the settings below come from the `public.wallet_config`, `public.wallet_networks` and `public.job_categories` tables instead of `FF.W.CFG`, so you can retune fees, minimums, deposit addresses and task categories from the Supabase dashboard without a redeploy.

| Setting | Value | Browser mode | Server mode |
| --- | --- | --- | --- |
| Min deposit | $10 | `FF.W.CFG.minDeposit` | `wallet_config.min_deposit` |
| Min withdrawal | $5 | `FF.W.CFG.minWithdraw` | `wallet_config.min_withdraw` |
| Withdrawal fee | 1% | `FF.W.CFG.withdrawFeePct` | `wallet_config.withdraw_fee_pct` |
| Platform fee (task creators) | 5% | `FF.W.CFG.platformFeePct` | `wallet_config.platform_fee_pct` |
| Min task reward | $0.02 per worker | hard-coded | `wallet_config.min_job_reward` |
| Points → USDT | 1000 pts = $1 | `FF.W.CFG.pointsPerUsdt` | `mining_config.points_per_usdt` |
| Min points to convert | 1000 | `FF.W.CFG.minPointsConvert` | `wallet_config.min_points_convert` |
| Deposit / withdrawal network | BEP20 (BNB Smart Chain) only | `FF.W.CFG.networks` | `wallet_networks` |
| Deposit address | `0xe85d1b6b330219de89e826f314a9bc2bcd595e53` | `FF.W.CFG.depositAddress` | `wallet_networks.address` |
| Task categories | 8 | `FF.W.CATEGORIES` | `job_categories` |

Deposits currently accept **USDT on BEP20 only**, to the verified address above (QR at `assets/img/deposit-bep20-qr.png`). To support another chain, insert a row into `public.wallet_networks` (server mode) or add a real verified address to `depositAddress` / `networkNote` / `depositQr` / `networks` in `FF.W.CFG` (browser mode) — never ship a placeholder address.

### Turning on server mode

1. Run [`supabase.sql`](supabase.sql), then [`supabase-mining.sql`](supabase-mining.sql) (it creates `public.balances`, shared by mining and the wallet).
2. Run [`supabase-wallet.sql`](supabase-wallet.sql) **as one script** in the Supabase SQL editor. It is idempotent — re-running it never touches existing balances, jobs or config.
3. Sign in with a Supabase Auth account — `wallet.html` should show **Server-synced**.

**Why it cannot be cheated:** exactly like mining, there is *no* insert/update/delete policy on any wallet or marketplace table and DML is revoked from `anon` and `authenticated`. Every write goes through a `security definer` RPC — `wallet_create_deposit`, `wallet_create_withdraw`, `wallet_convert_points`, `jobs_post`, `jobs_submit_proof`, `jobs_review`, `jobs_cancel` — which re-derives fees and amounts from `wallet_config` and holds row locks, so the escrow release and the worker credit happen in one transaction. A worker cannot approve their own proof, a proof cannot be paid twice, and a deposit is credited only after an admin approves it.

Members can `select` only their own `wallet_txns` / `pay_requests`; job listings are visible to signed-in members (that is how the market works) and a submission is visible only to its worker and the job owner.

### Admin

Admins listed in `window.FF_ADMIN_EMAILS` settle payment requests at `admin-payments.html`. In server mode the page calls `wallet_admin_queue`, `wallet_admin_settle`, `jobs_admin_review` and `jobs_admin_cancel`, all gated by the `public.admins` allowlist — the browser-side `FF_ADMIN_EMAILS` list is only a UI hint. Approving a deposit credits the balance; rejecting a withdrawal returns the locked funds; cancelling a task refunds the unused escrow to its owner.

## Points never zero out (browser ⇄ server merge)

Points and USDT earned **inside the browser** — the +25 welcome bonus, daily bonus missions, approved campaign work, and balances from before the Supabase upgrade — live in `localStorage`, while a signed-in member's **server ledger starts empty**. Earlier builds repainted the header chips straight from the server balance, so everything earned locally flashed for a second and then dropped to **0** on every page.

[`assets/js/wallet.js`](assets/js/wallet.js) now **merges** the two instead of overwriting (`reconcileServer()`):

- the header/panel chips always show **server balance + everything earned in this browser since the last sync** — the number can only grow locally, never reset;
- the merged value is written back to `localStorage`, so dashboard, wallet, mining and earn pages all paint the same number;
- server-side spends (points → USDT conversion, mining purchases) lower the baseline and are reflected on the next sync;
- logging in on a new browser adopts the server balance automatically (no duplicate welcome bonus), and points earned there sync back through the same merge.

**Optional (recommended): make browser-earned points server-spendable.** The merge above keeps the *display* correct, but the server can only spend points it knows about. Run [`supabase-points-import.sql`](supabase-points-import.sql) (after `supabase-wallet.sql` + `supabase-mining.sql`) to add a `wallet_import_points()` RPC: signed-in members hand their browser-earned points to the server ledger **at most once per day, capped at 10,000 points**, every import logged in `wallet_txns`. The site calls it automatically — with the SQL absent it silently skips and the merged display keeps working.

Regression tests for the merge live in [`tests/reconcile.test.js`](tests/reconcile.test.js) (`node tests/reconcile.test.js`).

## Cloud mining

`mining.html` + [`assets/js/mining.js`](assets/js/mining.js) add a hashrate-rental miner on top of the wallet. Users buy a contract with **USDT** (debited from `ff_wallets`) or with **points** (`1000 pts = $1`, same rate as the wallet converter), and the rig accrues rewards every second — including while the user is offline, because accrual is computed from wall-clock time on every read.

| Setting | Value | Where |
| --- | --- | --- |
| Output per 1 GH/s / day (gross) | $0.00105 | `FF.M.CFG.usdPerGhsDay` |
| Maintenance + pool fee | 8% (already deducted) | `FF.M.CFG.maintenancePct` |
| Custom rig price | $0.017–$0.020 per GH/s / 30 days | `FF.M.CFG.customTiers` |
| Custom rig range | 100 – 20,000 GH/s, 7+ days | `FF.M.CFG.customMinGhs` / `customMaxGhs` |
| Minimum claim | $0.05 | `FF.M.CFG.minClaimUsdt` |
| Claim-as-points bonus | +10% | `FF.M.CFG.pointsBonusPct` |
| Free daily boost | +25% for 8h, once per 24h | `FF.M.CFG.boostPct` / `boostHours` |

In server mode every value above is read from the `public.mining_config` row instead, so you can retune the economy live from the Supabase dashboard.

Plans live in `FF.M.PLANS` (free 30 GH/s starter rig + Bronze/Emerald/Silver/Gold/Titan/Diamond/Quantum). Emerald adds a $10 step above the $5 starter plan; Diamond and Quantum provide 6–12 TH/s and show estimated output above $5/day. Catalog estimates include the permanent +20% boost on qualifying purchases. Edit `usdPerGhsDay` to make the whole pool faster or slower.

### Two modes

| | Browser mode | **Server mode (recommended)** |
| --- | --- | --- |
| State lives in | `localStorage` (`ff_mining`) | Postgres, in your Supabase project |
| Can a user edit their balance from devtools? | **Yes** | **No** |
| Needs setup | none | run [`supabase-mining.sql`](supabase-mining.sql) |

The page shows which mode it is in via the **Balance mode** pill. Server mode
switches on automatically as soon as Supabase Auth is configured and the member
is signed in with a real Supabase account; otherwise the browser simulation is
used so local previews and the demo account keep working.

### Turning on server mode

1. Run [`supabase.sql`](supabase.sql) first (it creates `public.admins` and `public.is_admin()`).
2. Run [`supabase-mining.sql`](supabase-mining.sql) **as one script** in the Supabase SQL editor.
3. Sign in on the site with a Supabase Auth account — the mining page should show **Server-synced**.

That migration creates the catalog (`mining_config`, `mining_plans`,
`mining_custom_tiers`) and the per-user tables (`balances`, `mining_accounts`,
`mining_contracts`, `mining_ledger`). Tune the economy by editing rows in
`mining_config` / `mining_plans` — no redeploy needed, the page reads the
catalog from the server.

**Why it cannot be cheated:** there is deliberately *no* insert/update/delete
policy on any mining table, and write permission is revoked from `anon` and
`authenticated`. The only write path is a handful of `security definer`
functions — `mining_buy_plan`, `mining_buy_custom`, `mining_claim`,
`mining_boost` — which re-derive the price from the catalog and the elapsed
time from the server clock. The client sends only a plan key, a hashrate and a
currency; a forged price, hashrate or duration is ignored. Members can `select`
their own rows and nothing else.

Crediting a member (an approved deposit, a points migration) is an admin
action: `admin-payments.html` → **Cloud Mining** tab, which calls
`mining_admin_adjust(email, usdt, points, note)`. It is gated by the same
`public.admins` allowlist as the analytics dashboard, so the public
`FF_ADMIN_EMAILS` list in the browser config is only a UI hint.

Mining payouts appear in the browser wallet ledger as `mining` transactions
when running in browser mode; in server mode they land in `public.balances` and
the member's `mining_ledger`.

## Telegram bot

```bash
cd telegram-bot
pip install -r requirements.txt
cp .env.example .env   # BOT_TOKEN + ADMIN_IDS bharo
python bot.py
```

Poora guide: [`telegram-bot/README.md`](telegram-bot/README.md)
