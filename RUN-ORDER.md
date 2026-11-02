# FlexFam — Supabase SQL run order

Ye site bina Supabase ke bhi chalti hai (browser-only / localStorage fallback). Server mode chahiye — jahan balances, mining, wallet, escrow sab **Postgres** enforce kare — tab neeche diye gaye SQL scripts **isi order me** Supabase SQL editor me run karo. Har file ek hi baar poori select karke (Ctrl+A) Run karo, individual lines alag mat chalao. **Saari files idempotent hain — dobara run karna safe hai.**

| # | File | Kya banata / karta hai | Depends on |
|---|------|------------------------|------------|
| 1 | [`supabase.sql`](supabase.sql) | `public.admins`, profiles, `public.is_admin()` | — |
| 2 | [`supabase-mining.sql`](supabase-mining.sql) | `public.balances` table, cloud mining (`mining_config`, `mining_plans`, accrual, payouts) | 1 |
| 3 | [`supabase-wallet.sql`](supabase-wallet.sql) | USDT wallet, task marketplace, escrow, `wallet_*` RPCs | 1, 2 |
| 4 | [`supabase-points-import.sql`](supabase-points-import.sql) | *Optional:* `wallet_import_points()` — browser points ko server ledger me import | 1, 2, 3 |
| 5 | [`supabase-campaigns.sql`](supabase-campaigns.sql) | Point campaigns (Add Page → Earn page) server-sync — `market_campaigns` tables + `campaigns_*` RPCs. Iske bina user-posted campaigns sirf poster ke browser me dikhte the | 1, 2, 3 |
| 6 | [`supabase-proof-storage.sql`](supabase-proof-storage.sql) | Proof **screenshot attach** ke liye Storage bucket (`proofs`) + policies (images + short videos, 8 MB) — Task Market aur Earn campaigns dono me file upload; owner "View full proof" me full screenshot dekh sakta hai. **Dobara run karo** (naye extensions add karta hai). Bucket na ho to site compressed screenshot proof me embed kar deti hai — proof kabhi gayab nahi hota | — |
| 8 | [`supabase-campaigns-public.sql`](supabase-campaigns-public.sql) | **Public campaign listing** — demo/offline members ko bhi campaigns dikhti hain (bina login ke read-only listing). Complete karne ke liye real account | 5 |
| 9  | supabase-admin-member-detail.sql | Admin panel: member pe click → uski campaigns + Task Market tasks + completed tasks (points AUR USDT dono ke proofs/screenshot ke saath — `jobSubs`) | admin.html |
| 10 | supabase-campaigns-autoapprove.sql | Campaign auto-approve — proof submit karte hi points turant, owner review nahi | 5 |
| 7 | [`supabase-member-messages.sql`](supabase-member-messages.sql) | **Support message box** — member admin ko message bhej sake (site par 💬 button). Reply member ke dashboard inbox me aata hai. Depends on 1 + `supabase-community.sql` (messages tables) | — |
| 11 | supabase-campaigns-watch.sql | **Watch/View/Read timer earn** — `watch_secs` column + timer-mode campaigns (proof nahi, countdown → instant credit) | 5, 10 |
| 12 | supabase-admin-campaigns.sql | **Admin campaign manager** — admin.html me SAARI campaigns (kisne banayi — name + email), koi bhi edit (title/link/platform/action/payout/watch/pause) ya delete | 1, 5 |
| 13 | supabase-campaigns-limit.sql | **Engagement limit** — "kitne user tak campaign chalegi": Add Page par limit (0 = no limit), full hone par submit reject + "Limit reached ⛔" card, progress X/Y (Earn/Dashboard/Admin). Admin edit me bhi limit | 5, 12 |
| 14 | supabase-daily-streak.sql | **Daily streak — 90 day (TimeBucks style + earn rule)** — roz check-in → USDT (Day 1: $0.001 → Day 90: $5.50, Day 91+ $5.50/day; 9 ranks Rookie→Godlike; miss = reset). **Day 1-10 free, Day 11+ TimeBucks rule:** check-in se pehle window me earning chahiye (Day 11-50 = 24h, Day 51+ = 12h; na ho to streak Day 1 se restart) ($0.02→$5.00 rank ladder; tasks + mining + campaigns + referrals count, streak/deposit/convert nahi). Condition box Day 10 ke baad hi dikhta hai. Dashboard panel + countdown + coin sound; wallet history me "Daily streak" | 3 |
| 15 | supabase-campaign-quota.sql | **Campaign quota** — har platform par max 3 active campaigns per member (Add Page par live counter + submit block; server par post/toggle guard) | 13 |
| 16 | supabase-referral-pyramid.sql | **Referral pyramid** — 3-level referral income (L1 10% / L2 3% / L3 1%) har earning par (campaigns points, tasks/streak/mining USDT); Refer page par pyramid panel + income; wallet history me 'L1/L2/L3 referral income' entries | 3, 5, 13, 14, 15 (sab latest, sabse aakhir) |
| 17 | [`supabase-campaigns-url-fix.sql`](supabase-campaigns-url-fix.sql) | **URL fix** — `ff_normalize_url()` + `campaigns_post` ab link ko khud saaf karta hai (`t.me/x`, `www.foo.com/y`, extra space/zero-width/brackets sab chalte hain). Isse Add Page ka galat "Please enter a valid URL (https://...)" error khatam | 15 |
| 18 | [`supabase-admin-task-runners.sql`](supabase-admin-task-runners.sql) | **Admin task runners list** — admin.html ka naya "⚡ Tasks" section + Members table ka "Tasks running" column: har member ka scorecard (live/paused/total campaigns, posted Task Market tasks, tasks approved + pending proofs — points campaigns AUR USDT Task Market dono taraf se — aur coins spent) bina click kiye dikhta hai. `admin_task_runners()` RPC | 1, 3, 5 |
| 19 | [`supabase-admin-proofs.sql`](supabase-admin-proofs.sql) | **Admin proof review** — USDT Task Market + point campaign proofs ka unified review, View proof, approve/reject | 1, 3, 5 |
| 20 | [`supabase-member-warnings.sql`](supabase-member-warnings.sql) | **Member warnings** — admin warning/final warning, dashboard acknowledgement banner aur inbox message | 1 |
| 21 | [`supabase-post-task-admin.sql`](supabase-post-task-admin.sql) | **Post task quota + admin task manager** — ek member ek category (type) me max **3 live tasks**; Post a Task page par live counter; admin.html ka naya "📝 Posted tasks" section: edit / approve / pause / delete (delete par bacha hua escrow owner ko refund) + har task me **kaun member use run kar raha hai** (worker naam + status — `workers` field); Task Market me jyada reward wali task pehle | 3 |
| 22 | [`supabase-campaigns-top-bid.sql`](supabase-campaigns-top-bid.sql) | **Top bid first** — jis campaign par jyada coin/USDT bid hai wo Earn page par sabse pehle (payout desc, phir newest) | 13 |

> ⚠️ **Order zaroori hai:** `public.balances` table `supabase-mining.sql` (#2) me banti hai, isliye ye `supabase-wallet.sql` (#3) se **pehle** chalna chahiye. `supabase-points-import.sql` (#4) `wallet_state()` / `wallet_tx()` use karta hai jo `supabase-wallet.sql` (#3) me define hote hain, isliye wo sabse aakhir me.

---

## 🧾 Proof: typed text + screenshot (2026-11 update)

Worker ko ab **dono option hamesha milte hain** — `tasks.html` (USDT Task Market) aur `earn.html` (point campaigns) dono me:

`post-task.html` me poster ko bhi **dono** milte hain: `#j-proof` typing box (proof instructions) aur `#j-proof-file` example screenshot attach. Example worker ko task modal me "Example screenshot from the buyer" ke taur par dikhta hai (aur admin edit me preserve hota hai).

| Option | Field | Kahan save |
|---|---|---|
| ✍️ Typed text (multi-line) | `#jm-proof` / `#cm-text` — textarea | `proof` column ki pehli lines |
| 🔗 Proof link (optional) | `#jm-link` / `#cm-proof` | `🔗 Proof link: <url>` line |
| 📎 Screenshot / short video | `#jm-file` / `#cm-file` — file attach | `📎 Screenshot: <url>` line |
| 📝 Note | note textarea | `note` column (alag) |

Sab ek hi submission me jaate hain, koi overwrite nahi hota. `post-task.html` ka "Proof workers must submit" ab ek bada typing box hai jisme poster likhta hai ki worker kya proof bheje.

**Dekhne wale:**

* **Task poster** — `my-tasks.html → 👁 View proof` me typed text, link, note aur full-size screenshot ek card me; naya **All submissions & proofs** panel me approve/reject ke baad bhi proof dikhta hai.
* **Admin** — `admin.html → 🧾 Proofs` (pending/approved/rejected filters), `admin-payments.html` ke dono pending-proof tables, aur member detail modal me **View full proof** lightbox.
* **Worker** — `tasks.html → My submissions` aur `dashboard.html → Pending campaign proofs` me apna proof + thumbnail.
* Shared helper [`assets/js/proof.js`](assets/js/proof.js) purane `"text | https://...png"` proofs, plain URLs, data URLs aur naye marker wale proofs — sab parse karta hai. XSS-safe (sab text escape hota hai), aur data URL ko raw view me `[embedded screenshot]` se mask karta hai.

**Server mode me live karne ke liye (ek baar, idempotent):**

1. [`supabase-proof-storage.sql`](supabase-proof-storage.sql) (#6) **dobara run karo** — bucket me `avif / bmp / mp4 / webm / mov` extensions aur 8 MB limit add hoti hai. Ye bucket full-quality screenshots ke liye hai.
2. Agar task poster ko **reviewed (approved/rejected) proofs bhi** `All submissions` me dikhane hain: [`supabase-wallet.sql`](supabase-wallet.sql) (#3) aur [`supabase-post-task-admin.sql`](supabase-post-task-admin.sql) (#21) **dono dobara run karo** — `jobs_feed()` me naya `history` key add hota hai. Ye na karne par bhi page chalta hai (sirf pending proofs dikhte hain).

> Koi naya table/column nahi chahiye: text, link aur screenshot sab existing `proof TEXT` column me human-readable lines me rehte hain, isliye purane data safe hain aur admin SQL editor me bhi proof padha ja sakta hai. Agar Storage bucket abhi run nahi hua hai ya network offline hai, to site screenshot ko canvas se chhota karke proof ke andar embed kar deti hai — buyer/admin ko screenshot phir bhi dikhta hai.

Tests: `npm test` me [`tests/proof.test.js`](tests/proof.test.js) — build/parse, legacy proofs, XSS, poster modal, history panel aur admin queue ka end-to-end local flow.

---

## Daily streak earn rule live karne ke liye (TimeBucks rule update)

Day 11+ par **check-in se pehle earning window** (`streak_earn_req` ladder + `streak_earn_window_hrs` 24h/12h + `streak_earned_window` check + Dashboard condition box). Earning poori na ho aur check-in kare to **streak Day 1 se restart** hota hai deploy karne ke liye, Supabase SQL editor me **isi order me dobara run karo** (dono idempotent hain, data safe):

1. [`supabase-daily-streak.sql`](supabase-daily-streak.sql) (#14) — earn ladder + window check + `streak_state`/`streak_claim` update (adds `daily_streaks.last_claim_at`)
2. [`supabase-referral-pyramid.sql`](supabase-referral-pyramid.sql) (#16) — `streak_claim()` ki earn-rule wali copy (ye file claim ko overwrite karti hai, isliye #14 ke baad chalana **zaroori** hai warna rule bypass ho jayega)

Ladder: Day 1-10 free · 11-20 $0.02 · 21-30 $0.05 · 31-40 $0.10 · 41-50 $0.20 · 51-60 $0.40 · 61-70 $0.80 · 71-80 $1.50 · 81-90 $3.00 · 91+ $5.00. Count hota hai: tasks + mining claims + campaigns (points→USDT) + referrals. Window: Day 11-50 = last 24h · Day 51+ = last 12h, pichle check-in ke baad se (is se pehle ki earning nahi ginti). Streak bonus khud, deposits aur converts count nahi hote.

Restart rule: check-in ke time earning window me requirement poori na ho → `streak_claim` `ok:false, reset:true` return karta hai, streak 0 (agla check-in Day 1), koi reward nahi.

---

## Cloud mining ke naye numbers live karne ke liye (2026 update)

Latest mining changes — global gross rate **0.00105**, **+20% invest boost** ($10+ purchase wale contracts pe permanent), aur naye **Emerald ($10), Diamond (6 TH/s) aur Quantum (12 TH/s)** plans — front-end (`assets/js/mining.js`) me included hain. Diamond/Quantum ki estimated earning $5/day se aage jaati hai.

**Server mode** me ye numbers Postgres se aate hain, isliye deploy/merge ke baad ek baar [`supabase-mining.sql`](supabase-mining.sql) (#2) **dobara run karo**. Wo purane installs ko safely upgrade karta hai, naye plan rows add karta hai, aur agar rate abhi kisi purane shipped default par hai tabhi usko badalta hai. Admin ka custom rate overwrite nahi hota:

```sql
alter table public.mining_config add column if not exists invest_boost_min_usd numeric not null default 10;
alter table public.mining_config add column if not exists invest_boost_pct     numeric not null default 20;
update public.mining_config
   set usd_per_ghs_day = 0.00105, updated_at = now()
 where id = 1 and usd_per_ghs_day in (0.000826, 0.00095);
```

---

## Admin panel: member coin activity + payments (2026-09 update)

`admin.html` ab in-panel **payments approve/reject**, har member ke **coins**, aur email click karke **coin activity + coin editor** dikhata hai. Ye sab server RPCs (`wallet_admin_queue`, `wallet_admin_settle`, `mining_admin_adjust`) aur admin read policies par chalta hai. Naye feature use karne se pehle migrations ko latest version par lao:

1. [`supabase.sql`](supabase.sql) (#1) — pehle se run hai to skip kar sakte ho
2. [`supabase-mining.sql`](supabase-mining.sql) (#2) — **dobara run karo** (naye `admins read all mining accounts` / `admins read all mining logs` policies add karta hai)
3. [`supabase-wallet.sql`](supabase-wallet.sql) (#3) — **dobara run karo** (payment queue + settle RPCs)

Saari files idempotent hain — dobara run karne se data delete nahi hota. Agar in-panel kisi section me "run the migration" wala warning dikhe, iska matlab corresponding file abhi run nahi hui.

---

## Referral free rig + messages + coin editor (2026-09 update)

Naya file: [`supabase-community.sql`](supabase-community.sql) — ise **#4 ke baad, sabse aakhir me** ek baar run karo (idempotent hai).

| # | File | Kya add karta hai |
|---|------|-------------------|
| 5 | [`supabase-community.sql`](supabase-community.sql) | `referral_codes` / `referrals` + `referral_stats()`, free rig ka referral gate (`mining_buy_plan` update), `messages` + `message_reads` (`messages_admin_send`, `messages_admin_recent`, `messages_inbox`, `messages_mark_read`), aur `mining_admin_set()` (exact coin/USDT value) |

Kya badla:

* **Free Starter Rig ab referral se unlock hota hai.** Pehle sabko milta tha; ab har **successful signup** (koi aapke `signup.html?ref=FF-XXXXXXXX` link se account banata hai) ek free rig unlock karta hai. Sirf link click karne se kuch nahi hota.
* Free rig ka output thoda badha diya: **30 GH/s / 7 din → 60 GH/s / 10 din**.
* **Messages:** admin panel se poore members ko **broadcast** ya kisi ek member ko **direct message** bhejo. Member ko wo dashboard ke "Messages" panel me dikhta hai, unread badge ke saath.
* **Admin coin editor:** ab `± Add / subtract` ke saath `= Set exact value` mode bhi hai, aur coins pe galat `$` sign nahi lagta (coins = coins, USDT = USDT alag dikhte hain).
* Dashboard se **Quick earning modes** panel hata diya, **Recent activity** ab points + wallet + mining sab merge karke dikhata hai, aur **"Site today — real data"** card page ke sabse neeche chala gaya hai.

> Bina Supabase ke bhi sab kaam karta hai (browser-only fallback): referrals `ff_referrals` me, messages `ff_messages` me local store hote hain.

---

## Fix: UPI withdraw — "invalid regular expression: invalid repetition count(s)"

`wallet_request_withdraw()` me UPI ID validate karne wala regex `{2,256}` use kar raha tha. **Postgres regex me repetition count 255 se zyada nahi ho sakta**, isliye har UPI withdrawal pe ye error aata tha. Ab wo `{2,255}` hai (UPI ID waise bhi itni lambi hoti hi nahi).

Fix live karne ke liye [`supabase-wallet.sql`](supabase-wallet.sql) ko **ek baar dobara run karo** (idempotent hai, data safe rehta hai).

---

## UPI deposit + withdraw live (2026-09)

UPI ab **deposit aur withdraw dono** me enabled hai.

* **Deposit UPI ID:** `ravanyt001-2@okaxis`
* **QR:** `assets/img/deposit-upi-qr.png` — standard UPI intent URI (`upi://pay?pa=ravanyt001-2@okaxis&pn=FlexFam&cu=INR`), GPay / PhonePe / Paytm / BHIM sab me scan hota hai
* Deposit form UPI choose karne par TXID ki jagah **UTR / reference number** maangta hai, aur warning list bhi UPI wali dikhati hai
* Withdraw pehle se UPI support karta tha — wahan member apni khud ki UPI ID daalta hai

Server pe live karne ke liye [`supabase-wallet.sql`](supabase-wallet.sql) **ek baar dobara run karo** (`wallet_networks` ka UPI row update ho jayega + UTR wala error message).

---

## Admin "kaun activity kar raha hai" + USDT → Points (2026-09)

### 1. Recent events me member ka naam
`events` table me ab do naye columns hain — `email` aur `user_name`. Logged-in member ka event uske naam/email ke saath record hota hai; signed-out visitor sirf anonymous visitor id dikhata hai (privacy same rehti hai).

Admin panel me:
* **Recent events** table me naya **"Who"** column — member ka naam click karke seedha uska coin activity + coin editor modal khul jata hai
* **Referrers** panel (jo khali tha) ki jagah ab **"Most active members"** — kaun sabse zyada use kar raha hai, event count ke saath

Run karo: [`supabase.sql`](supabase.sql) **dobara** (sirf `alter table ... add column if not exists` add karta hai, data safe).

### 2. USDT → Points (reverse convert)
Wallet ka "Points → USDT" tab ab **"Convert"** hai, jisme dono direction ka toggle hai:
* **Points → USDT** (pehle wala)
* **USDT → Points** — naya. Same rate, koi fee nahi, minimum $1. Isse member apne USDT se campaigns fund kar sakta hai, task workers ko pay kar sakta hai ya mining hashrate khareed sakta hai.

Run karo: [`supabase-wallet.sql`](supabase-wallet.sql) **dobara** (naya `wallet_convert_usdt()` RPC + `min_usdt_convert` config column).

Agar sirf ye exact error aa raha ho — **“Could not find the function public.wallet_convert_usdt(p_amount) in the schema cache”** — to chhota focused hotfix [`supabase-wallet-convert-usdt-fix.sql`](supabase-wallet-convert-usdt-fix.sql) SQL Editor me poora run kar sakte ho. Ye missing function + permission install karke PostgREST schema cache turant reload karta hai; balances ya transaction data reset nahi hota.

---

## Message box: "msg cut ja raha hai" → tap karke poora message (2026-11 update)

Pehle bell notifications 2 line me, dashboard inbox aur admin message log narrow table cell me **cut** ho jaate the aur poora padhne ka koi option nahi tha. Ab sab message surfaces par **tap/click (ya keyboard se Enter/Space)** karne par ek bada **Full message** modal khulta hai:

* 🔔 **Bell notifications** — `.bi-body` ab 3-line preview + "👆 Tap to read full message"; kholne par sirf wahi notification read hoti hai (`bell_mark_read`).
* 📥 **Dashboard → Messages** — har row clickable; full view me **poora title + body**, line breaks, wrapping, sender/audience/date. Kholne par **sirf usi message** ka read flag set hota hai — "Mark all read" button waise hi kaam karta hai.
* 💬 **Support 💬 box** — "Your recent messages" ke items tap karne par poora message; text `pre-wrap` + `overflow-wrap:anywhere` se kabhi side me nahi kata.
* 📋 **Admin → Messages → Inbox / Sent** — poora `<tr>` clickable, cells me `overflow:visible` + `text-overflow:clip`, log height 240px → 460px.

Shared component [`assets/js/message-view.js`](assets/js/message-view.js) (`window.FFMessage`) sab pages par [`assets/js/bell.js`](assets/js/bell.js) se pehle load hota hai, kisi `FF`/Supabase API par depend nahi karta, sab text **escape** karta hai, links readable rehte hain, aur Escape / backdrop / Close button se band hota hai. Mobile touch + keyboard dono supported.

**Server mode me live karne ke liye (optional but recommended):** [`supabase-community.sql`](supabase-community.sql) **ek baar dobara run karo** — isme naya `messages_mark_one_read(uuid)` RPC add hua hai (sirf khola hua message read mark karta hai). Ye file idempotent hai, data safe. RPC na ho to bhi site chalati hai: read flag browser/local fallback me save hota hai aur page crash nahi karta. Bell ke liye [`supabase-notifications.sql`](supabase-notifications.sql) pehle se hi `bell_mark_read(p_ids)` provide karta hai — koi naya table/column nahi chahiye.

Tests: `npm test` me [`tests/messages.test.js`](tests/messages.test.js) — shared modal runtime (long text, newlines, XSS, Escape/Enter), dashboard inbox tap + per-message read + "Mark all read", aur sab 4 surfaces ki wiring. Proof flow (`tests/proof.test.js`) bhi unchanged pass rehta hai.
