# FlexFam — Supabase SQL run order

Ye site bina Supabase ke bhi chalti hai (browser-only / localStorage fallback). Server mode chahiye — jahan balances, mining, wallet, escrow sab **Postgres** enforce kare — tab neeche diye gaye SQL scripts **isi order me** Supabase SQL editor me run karo. Har file ek hi baar poori select karke (Ctrl+A) Run karo, individual lines alag mat chalao. **Saari files idempotent hain — dobara run karna safe hai.**

| # | File | Kya banata / karta hai | Depends on |
|---|------|------------------------|------------|
| 1 | [`supabase.sql`](supabase.sql) | `public.admins`, profiles, `public.is_admin()` | — |
| 2 | [`supabase-mining.sql`](supabase-mining.sql) | `public.balances` table, cloud mining (`mining_config`, `mining_plans`, accrual, payouts) | 1 |
| 3 | [`supabase-wallet.sql`](supabase-wallet.sql) | USDT wallet, task marketplace, escrow, `wallet_*` RPCs | 1, 2 |
| 4 | [`supabase-points-import.sql`](supabase-points-import.sql) | *Optional:* `wallet_import_points()` — browser points ko server ledger me import | 1, 2, 3 |

> ⚠️ **Order zaroori hai:** `public.balances` table `supabase-mining.sql` (#2) me banti hai, isliye ye `supabase-wallet.sql` (#3) se **pehle** chalna chahiye. `supabase-points-import.sql` (#4) `wallet_state()` / `wallet_tx()` use karta hai jo `supabase-wallet.sql` (#3) me define hote hain, isliye wo sabse aakhir me.

---

## Cloud mining ke naye numbers live karne ke liye (2025 update)

Latest mining changes — global rate **0.00095**, **+20% invest boost** ($10+ purchase wale contracts pe permanent), aur plans **bronze 260 / silver 620 / gold 1100 / titan 2000 GH/s** — front-end (`assets/js/mining.js`) me already live hain aur GitHub Pages pe deploy ho chuke hain.

**Server mode** me ye numbers Postgres se aate hain, isliye ek baar [`supabase-mining.sql`](supabase-mining.sql) (#2) **dobara run karo**. Wo purane installs ko safely upgrade kar deta hai:

```sql
alter table public.mining_config add column if not exists invest_boost_min_usd numeric not null default 10;
alter table public.mining_config add column if not exists invest_boost_pct     numeric not null default 20;
update public.mining_config set usd_per_ghs_day = 0.00095 where id = 1 and usd_per_ghs_day = 0.000826;
```
