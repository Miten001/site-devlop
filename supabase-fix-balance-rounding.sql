-- ============================================================
--  FLEXFAM — balance rounding fix
-- ============================================================
-- SYMPTOM
--   Buying hashrate / withdrawing / posting a task failed with
--     "Need $1.20 USDT — you have $1.20"
--   even though the wallet clearly showed the full amount.
--
-- CAUSE
--   Balances are stored with up to 8 decimals (1.1996) but every page shows
--   them rounded to 2 ("$1.20"). The server compared the raw numbers with a
--   strict "<", so the purchase was rejected — and the error message rounded
--   both sides, printing the same number twice.
--
-- FIX
--   Compare and display at cent precision, and clamp the debit at zero so the
--   sub-cent difference is absorbed instead of producing a negative balance.
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL editor and press Run once.
--   It only uses "create or replace", so it is safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Charging points/USDT for a mining rig
-- (from supabase-mining.sql)
-- ------------------------------------------------------------
create or replace function public.mining_charge(p_user uuid, p_price numeric, p_currency text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg public.mining_config; bal public.balances; v_points bigint;
begin
  if p_price <= 0 then
    return jsonb_build_object('paid_with', 'free', 'paid_amount', 0);
  end if;

  select * into cfg from public.mining_config where id = 1;
  insert into public.balances (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = p_user for update;

  if p_currency = 'points' then
    v_points := ceil(p_price * cfg.points_per_usdt);
    if bal.points < v_points then
      raise exception 'Need % points — you have %', v_points, bal.points using errcode = 'P0001';
    end if;
    update public.balances set points = points - v_points, updated_at = now() where user_id = p_user;
    return jsonb_build_object('paid_with', 'points', 'paid_amount', v_points);
  end if;

  if p_currency <> 'usdt' then
    raise exception 'Unsupported currency %', p_currency using errcode = 'P0001';
  end if;

  /* Compare at cent precision. Balances keep up to 8 decimals but every page
     shows them rounded to 2, so "$1.20" on screen can really be 1.1996 — a
     strict "<" then rejects a purchase with
     "Need $1.20 USDT — you have $1.20", which looks like a broken button.
     Rounding both sides fixes that; the debit is clamped at zero so the
     sub-cent difference is absorbed instead of creating a negative balance. */
  if round(bal.usdt, 2) < round(p_price, 2) then
    raise exception 'Need $% USDT — you have $%. Deposit or convert points first.',
      round(p_price, 2), round(bal.usdt, 2) using errcode = 'P0001';
  end if;
  update public.balances
     set usdt = greatest(0, round(usdt - p_price, 8)), updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('paid_with', 'usdt', 'paid_amount', p_price);
end;
$$;


-- ------------------------------------------------------------
-- Withdrawing USDT
-- (from supabase-wallet.sql)
-- ------------------------------------------------------------
create or replace function public.wallet_create_withdraw(p_amount numeric, p_network text, p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_fee numeric;
  v_id uuid;
begin
  select * into cfg from public.wallet_config where id = 1;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

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
-- Converting USDT back into points
-- (from supabase-wallet.sql)
-- ------------------------------------------------------------
create or replace function public.wallet_convert_usdt(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  v_amount := round(coalesce(p_amount, 0), 4);

  if v_amount < cfg.min_usdt_convert then
    raise exception 'Minimum $% USDT to convert', cfg.min_usdt_convert using errcode = 'P0001';
  end if;
  /* cent-precision compare — see wallet_create_withdraw */
  if round(v_amount, 2) > round(bal.usdt, 2) then
    raise exception 'Not enough available USDT — you have $%', round(bal.usdt, 2) using errcode = 'P0001';
  end if;

  v_points := floor(v_amount * v_rate);
  if v_points < 1 then
    raise exception 'That amount is too small to convert' using errcode = 'P0001';
  end if;

  update public.balances
     set usdt = greatest(0, round(usdt - v_amount, 8)),
         points = points + v_points,
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(v_user, 'convert', -v_amount,
    '$' || v_amount || ' USDT converted to ' || v_points || ' points', 'completed', null, null);

  return public.wallet_state();
end;
$$;


-- ------------------------------------------------------------
-- Posting a USDT task (escrow)
-- (from supabase-post-task-admin.sql)
-- ------------------------------------------------------------
create or replace function public.jobs_post(
  p_title text, p_category text, p_description text, p_url text,
  p_proof_note text, p_reward numeric, p_slots int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_cat text := coalesce(nullif(trim(p_category), ''), 'other');
  v_catname text;
  v_live int;
  v_budget numeric; v_fee numeric; v_total numeric;
begin
  select * into cfg from public.wallet_config where id = 1;

  if p_title is null or length(trim(p_title)) < 6 then
    raise exception 'Task title must be at least 6 characters' using errcode = 'P0001';
  end if;
  if p_description is null or length(trim(p_description)) < 20 then
    raise exception 'Describe the task in at least 20 characters' using errcode = 'P0001';
  end if;
  if p_reward is null or p_reward < cfg.min_job_reward then
    raise exception 'Minimum reward is $% per worker', cfg.min_job_reward using errcode = 'P0001';
  end if;
  if p_slots is null or p_slots < 1 then
    raise exception 'At least 1 worker slot is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.job_categories where key = v_cat) then
    raise exception 'Unknown task category' using errcode = 'P0001';
  end if;

  /* QUOTA — at most 3 live tasks per category */
  select count(*) into v_live
    from public.jobs
   where owner = v_user and category = v_cat
     and status in ('active', 'paused');

  if v_live >= 3 then
    select name into v_catname from public.job_categories where key = v_cat;
    raise exception
      'Limit reached: only 3 live % tasks at a time — cancel or finish one first',
      coalesce(v_catname, v_cat) using errcode = 'P0001';
  end if;

  v_budget := round(p_reward * p_slots, 8);
  v_fee    := round(v_budget * cfg.platform_fee_pct / 100.0, 4);
  v_total  := round(v_budget + v_fee, 8);

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  /* cent-precision compare + clamped debit — the wallet page rounds to 2
     decimals, so "$1.20" on screen can really be 1.1996. */
  if round(bal.usdt, 2) < round(v_total, 2) then
    raise exception 'Need $% USDT in your wallet (incl. % fee) — you have $%. Deposit or convert points first.',
      round(v_total, 2), public.wallet_pct_label(cfg.platform_fee_pct),
      round(bal.usdt, 2) using errcode = 'P0001';
  end if;

  update public.balances
     set usdt = greatest(0, round(usdt - v_total, 8)), locked = round(locked + v_budget, 8), updated_at = now()
   where user_id = v_user;

  insert into public.jobs (owner, title, category, description, url, proof_note, reward, slots, escrow, fee)
  values (v_user, trim(p_title), v_cat, trim(p_description),
          coalesce(trim(p_url), ''),
          coalesce(nullif(trim(p_proof_note), ''), 'Screenshot / proof link of the completed action'),
          p_reward, p_slots, v_budget, v_fee);

  perform public.wallet_tx(v_user, 'escrow', -v_total,
    'Escrow for task "' || trim(p_title) || '" (' || p_slots || ' slots + ' || cfg.platform_fee_pct || '% fee)',
    'completed', null, null);

  return public.jobs_feed();
end;
$$;


-- ------------------------------------------------------------
-- Admin editing a posted task
-- (from supabase-post-task-admin.sql)
-- ------------------------------------------------------------
create or replace function public.admin_jobs_update(
  p_job         uuid,
  p_title       text,
  p_category    text,
  p_description text,
  p_url         text,
  p_proof_note  text,
  p_reward      numeric,
  p_slots       int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
  v_cat text;
  v_reward numeric; v_slots int;
  v_need numeric; v_diff numeric;
  bal public.balances;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;

  if p_title is null or length(trim(p_title)) < 6 then
    raise exception 'Task title must be at least 6 characters' using errcode = 'P0001';
  end if;

  v_cat    := coalesce(nullif(trim(p_category), ''), j.category);
  if not exists (select 1 from public.job_categories where key = v_cat) then
    raise exception 'Unknown task category' using errcode = 'P0001';
  end if;

  v_reward := coalesce(p_reward, j.reward);
  v_slots  := coalesce(p_slots,  j.slots);
  if v_reward <= 0 then raise exception 'Reward must be greater than 0' using errcode = 'P0001'; end if;
  if v_slots < greatest(j.filled, 1) then
    raise exception 'Slots cannot be lower than the % already filled', j.filled using errcode = 'P0001';
  end if;

  /* how much escrow the remaining (unfilled) slots need */
  v_need := round(v_reward * (v_slots - j.filled), 8);
  if j.status in ('cancelled', 'completed') then v_need := j.escrow; end if;
  v_diff := round(v_need - j.escrow, 8);

  if v_diff <> 0 then
    insert into public.balances (user_id) values (j.owner) on conflict (user_id) do nothing;
    select * into bal from public.balances where user_id = j.owner for update;

    if v_diff > 0 then
      if round(bal.usdt, 2) < round(v_diff, 2) then
        raise exception 'Owner needs $% more USDT in their wallet for this change — they have $%',
          round(v_diff, 2), round(bal.usdt, 2) using errcode = 'P0001';
      end if;
      update public.balances
         set usdt = greatest(0, round(usdt - v_diff, 8)), locked = round(locked + v_diff, 8), updated_at = now()
       where user_id = j.owner;
      perform public.wallet_tx(j.owner, 'escrow', -v_diff,
        'Extra escrow after an admin edited "' || trim(p_title) || '"', 'completed', null, j.id);
    else
      update public.balances
         set locked = round(locked + v_diff, 8), usdt = round(usdt - v_diff, 8), updated_at = now()
       where user_id = j.owner;
      perform public.wallet_tx(j.owner, 'refund', -v_diff,
        'Escrow released after an admin edited "' || trim(p_title) || '"', 'completed', null, j.id);
    end if;
  end if;

  update public.jobs set
    title       = trim(p_title),
    category    = v_cat,
    description = coalesce(nullif(trim(p_description), ''), description),
    url         = coalesce(trim(p_url), ''),
    proof_note  = coalesce(nullif(trim(p_proof_note), ''), proof_note),
    reward      = v_reward,
    slots       = v_slots,
    escrow      = v_need
  where id = j.id;

  return public.admin_jobs_list();
end;
$$;
