-- FlexFam hotfix: install the missing USDT -> Points RPC on an existing database.
-- Run this whole file once in Supabase Dashboard -> SQL Editor.
-- Safe to re-run: it does not delete or reset balances, transactions, or config.
-- Requires supabase-mining.sql and supabase-wallet.sql to have been run before.

alter table public.wallet_config
  add column if not exists min_usdt_convert numeric not null default 1;

create or replace function public.wallet_convert_usdt(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_rate int;
  v_points bigint;
  v_amount numeric;
begin
  select * into cfg from public.wallet_config where id = 1;
  select points_per_usdt into v_rate from public.mining_config where id = 1;

  if cfg.id is null then
    raise exception 'Wallet configuration is missing' using errcode = 'P0001';
  end if;
  if coalesce(v_rate, 0) <= 0 then
    raise exception 'Points conversion rate is not configured' using errcode = 'P0001';
  end if;

  insert into public.balances (user_id)
  values (v_user)
  on conflict (user_id) do nothing;

  select * into bal
    from public.balances
   where user_id = v_user
   for update;

  v_amount := round(coalesce(p_amount, 0), 4);

  if v_amount < cfg.min_usdt_convert then
    raise exception 'Minimum $% USDT to convert', cfg.min_usdt_convert using errcode = 'P0001';
  end if;
  if v_amount > bal.usdt then
    raise exception 'Not enough available USDT — you have $%', round(bal.usdt, 2) using errcode = 'P0001';
  end if;

  v_points := floor(v_amount * v_rate);
  if v_points < 1 then
    raise exception 'That amount is too small to convert' using errcode = 'P0001';
  end if;

  update public.balances
     set usdt = round(usdt - v_amount, 8),
         points = points + v_points,
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(
    v_user,
    'convert',
    -v_amount,
    '$' || v_amount || ' USDT converted to ' || v_points || ' points',
    'completed',
    null,
    null
  );

  return public.wallet_state();
end;
$$;

revoke all on function public.wallet_convert_usdt(numeric) from public, anon;
grant execute on function public.wallet_convert_usdt(numeric) to authenticated;

-- Make PostgREST notice the new RPC immediately instead of waiting for its
-- schema cache refresh interval.
notify pgrst, 'reload schema';
