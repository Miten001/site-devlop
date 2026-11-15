-- ============================================================
--  FLEXFAM — one withdrawal at a time                    (#25)
-- ============================================================
-- RULE
--   A member can have only ONE withdrawal waiting for approval.
--   The next request is accepted after an admin approves the current
--   one (or rejects it, which returns the money to the balance).
--
-- WHAT THIS FILE CHANGES
--   Only public.wallet_create_withdraw() — one extra check before a
--   new request is created. A member who already has a withdrawal
--   pending is told:
--     "You already have a withdrawal of $12.46 waiting for approval.
--      You can request the next one after it is approved."
--
--   No table, balance or existing request is touched. Withdrawals
--   that were already pending before this file was run stay pending
--   and are approved / rejected from the admin panel as usual — a
--   member who has several of them can ask for another one only after
--   all of them are settled.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste this ENTIRE file → Run.
--   Safe to re-run ("create or replace" only).
--   Requires: supabase.sql, supabase-mining.sql, supabase-wallet.sql.
--
--   The same function is also kept in supabase-wallet.sql (fresh
--   installs) and supabase-fix-balance-rounding.sql, so running either
--   of those later does not remove the rule.
-- ============================================================

do $$
begin
  if to_regclass('public.pay_requests') is null or to_regclass('public.balances') is null
     or to_regprocedure('public.wallet_state()') is null then
    raise exception 'wallet tables are missing — run supabase-mining.sql and supabase-wallet.sql first';
  end if;
end $$;

create or replace function public.wallet_create_withdraw(p_amount numeric, p_network text, p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_fee numeric;
  v_id uuid;
  v_open int;
  v_open_amt numeric;
begin
  select * into cfg from public.wallet_config where id = 1;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  /* One withdrawal at a time: the next request is accepted only after an
     admin has approved (or rejected) the one that is waiting. The balance
     row is locked just above, so two requests sent at the same moment queue
     up here and the second one sees the first. Requests that were already
     pending before this rule are left alone. */
  select count(*), coalesce(sum(amount), 0) into v_open, v_open_amt
    from public.pay_requests
   where user_id = v_user and kind = 'withdraw' and status = 'pending';
  if v_open = 1 then
    raise exception 'You already have a withdrawal of $% waiting for approval. You can request the next one after it is approved.',
      round(v_open_amt, 2) using errcode = 'P0001';
  elsif v_open > 1 then
    raise exception 'You already have % withdrawals ($% in total) waiting for approval. You can request the next one after they are approved.',
      v_open, round(v_open_amt, 2) using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount < cfg.min_withdraw then
    raise exception 'Minimum withdrawal is $% USDT', cfg.min_withdraw using errcode = 'P0001';
  end if;
  /* Cent-precision compare: the wallet shows 2 decimals, the balance keeps 8.
     Without this a member whose page reads "$1.20" gets rejected withdrawing
     "1.20" because the real balance is 1.1996. */
  if round(p_amount, 2) > round(bal.usdt, 2) then
    raise exception 'Not enough available balance — you have $%', round(bal.usdt, 2) using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.wallet_networks where network = p_network and withdraw) then
    raise exception 'Select a supported payout method' using errcode = 'P0001';
  end if;
  if p_network = 'UPI' then
    -- NOTE: a Postgres regex repetition count may not exceed 255, so the
    -- local part is capped at 255 here (a UPI ID is far shorter anyway).
    -- Using {2,256} raises: invalid regular expression: invalid repetition count(s)
    if p_address is null or trim(p_address) !~* '^[A-Z0-9._-]{2,255}@[A-Z0-9.-]{2,64}$' then
      raise exception 'Enter a valid UPI ID (for example, name@bank)' using errcode = 'P0001';
    end if;
  elsif p_address is null or length(trim(p_address)) < 15 then
    raise exception 'Enter a valid USDT wallet address' using errcode = 'P0001';
  end if;

  v_fee := round(p_amount * cfg.withdraw_fee_pct / 100.0, 2);

  -- move the money out of spendable and into locked in the same statement
  update public.balances
     set usdt = greatest(0, round(usdt - p_amount, 8)), locked = round(locked + p_amount, 8), updated_at = now()
   where user_id = v_user;

  insert into public.pay_requests (user_id, kind, amount, fee, receive, network, address)
  values (v_user, 'withdraw', p_amount, v_fee, round(p_amount - v_fee, 2), p_network, trim(p_address))
  returning id into v_id;

  perform public.wallet_tx(v_user, 'withdraw', -p_amount,
    'Withdrawal to ' || p_network || ' (fee $' || v_fee || ')', 'pending', v_id, null);

  return public.wallet_state();
end;
$$;

-- ------------------------------------------------------------
-- Permissions stay exactly as supabase-wallet.sql set them:
-- signed-in members only, never the anonymous role.
-- ------------------------------------------------------------
revoke all on function public.wallet_create_withdraw(numeric, text, text) from public, anon;
grant execute on function public.wallet_create_withdraw(numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
