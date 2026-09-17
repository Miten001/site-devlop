-- ============================================================
-- FlexFam — OPTIONAL: import browser-earned points into the
-- server ledger (wallet_import_points)
--
-- Run this ONCE in the Supabase SQL editor AFTER supabase-wallet.sql
-- and supabase-mining.sql. Safe to re-run (idempotent).
--
-- WHY THIS EXISTS
-- Points earned inside the browser (welcome bonus, daily bonus missions,
-- approved campaign work, balances from before the Supabase upgrade) are
-- stored in localStorage on the member's device. The server ledger in
-- public.balances starts empty, so in server mode the site used to repaint
-- the header chips from the server balance — and everything the member had
-- earned in the browser looked like it reset to zero.
--
-- The frontend now MERGES the two numbers (server balance + points earned
-- in this browser) so nothing disappears from the display. This function
-- goes one step further: it lets the member hand those browser-earned
-- points over to the server ledger, so they also become spendable where
-- the server enforces the balance — the points → USDT conversion
-- (wallet_convert_points) and mining purchases paid with points
-- (mining_buy_plan / mining_buy_custom with p_currency = 'points').
--
-- SAFETY
-- • authenticated members only (uses the caller's auth.uid())
-- • at most ONE import per member per UTC day
-- • each import is capped at 10,000 points (≈ $10 USDT at 1000 pts/$1)
-- • every import is logged in wallet_txns as an 'adjust' entry, visible
--   to the admin in the wallet history
-- • withdrawals still pass through the admin approval queue
-- ============================================================

alter table public.balances
  add column if not exists points_import_day date;

create or replace function public.wallet_import_points(p_points bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  v_points bigint;
  v_cap constant bigint := 10000;   -- max points importable per day
begin
  if p_points is null or p_points < 1 then
    raise exception 'Nothing to import' using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;

  if exists (select 1 from public.balances
              where user_id = v_user and points_import_day = current_date) then
    raise exception 'Browser points already imported today — try again tomorrow'
      using errcode = 'P0001';
  end if;

  v_points := least(p_points, v_cap);

  update public.balances
     set points = points + v_points,
         points_import_day = current_date,
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(v_user, 'adjust', v_points,
    'Imported browser-earned points', 'completed', null, null);

  return public.wallet_state();
end;
$$;

revoke all on function public.wallet_import_points(bigint) from public, anon;
grant execute on function public.wallet_import_points(bigint) to authenticated;
