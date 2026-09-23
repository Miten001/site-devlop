# FlexFam — Supabase SQL run order

Ye site bina Supabase ke bhi chalti hai (browser-only / localStorage fallback). Server mode chahiye — jahan balances, mining, wallet, escrow sab **Postgres** enforce kare — tab neeche diye gaye SQL scripts **isi order me** Supabase SQL editor me run karo. Har file ek hi baar poori select karke (Ctrl+A) Run karo, individual lines alag mat chalao. **Saari files idempotent hain — dobara run karna safe hai.**

| # | File | Kya banata / karta hai | Depends on |
|---|------|------------------------|------------|
| 1 | [`supabase.sql`](supabase.sql) | `public.admins`, profiles, `public.is_admin()` | — |
| 2 | [`supabase-mining.sql`](supabase-mining.sql) | `public.balances` table, cloud mining (`mining_config`, `mining_plans`, accrual, payouts) | 1 |
| 3 | [`supabase-wallet.sql`](supabase-wallet.sql) | USDT wallet, task marketplace, escrow, `wallet_*` RPCs | 1, 2 |
| 4 | [`supabase-points-import.sql`](supabase-points-import.sql) | *Optional:* `wallet_import_points()` — browser points ko server ledger me import | 1, 2, 3 |
| 5 | [`supabase-campaigns.sql`](supabase-campaigns.sql) | Point campaigns (Add Page → Earn page) server-sync — `market_campaigns` tables + `campaigns_*` RPCs. Iske bina user-posted campaigns sirf poster ke browser me dikhte the | 1, 2, 3 |
| 6 | [`supabase-proof-storage.sql`](supabase-proof-storage.sql) | Proof **screenshot attach** ke liye Storage bucket (`proofs`) + policies — task proof me file upload, owner "View" me screenshot dekh sakta hai | — |
| 8 | [`supabase-campaigns-public.sql`](supabase-campaigns-public.sql) | **Public campaign listing** — demo/offline members ko bhi campaigns dikhti hain (bina login ke read-only listing). Complete karne ke liye real account | 5 |
| 9  | supabase-admin-member-detail.sql | Admin panel: member pe click → uski campaigns + completed tasks (proofs) | admin.html |
| 7 | [`supabase-member-messages.sql`](supabase-member-messages.sql) | **Support message box** — member admin ko message bhej sake (site par 💬 button). Reply member ke dashboard inbox me aata hai. Depends on 1 + `supabase-community.sql` (messages tables) | — |

> ⚠️ **Order zaroori hai:** `public.balances` table `supabase-mining.sql` (#2) me banti hai, isliye ye `supabase-wallet.sql` (#3) se **pehle** chalna chahiye. `supabase-points-import.sql` (#4) `wallet_state()` / `wallet_tx()` use karta hai jo `supabase-wallet.sql` (#3) me define hote hain, isliye wo sabse aakhir me.

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
