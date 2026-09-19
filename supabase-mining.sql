-- FlexFam — server-side cloud mining (Supabase / Postgres)
--
-- HOW TO RUN: run supabase.sql FIRST (it creates public.admins and
-- public.is_admin(), which this file depends on), then select this ENTIRE
-- file (Ctrl+A), paste it into the Supabase SQL editor and hit Run once.
--
-- Safe to re-run as many times as you like.
--
-- WHY THIS EXISTS
-- The browser build keeps mining state in localStorage, which any user can
-- edit from the devtools console. Everything below moves the *authoritative*
-- state into Postgres:
--   * balances, contracts, accrual and payouts live in tables no browser can
--     write to (no insert/update/delete policy exists on any of them),
--   * every mutation goes through a `security definer` RPC that re-derives
--     prices and elapsed time from the server clock,
--   * the browser may only SELECT its own rows.
-- A client that forges a price, a hashrate or an elapsed duration is simply
-- ignored: the function recomputes all of it.

-- ============================================================
-- 0. Prerequisites
-- ============================================================
-- gen_random_uuid() is built into Postgres 13+, which every current Supabase
-- project runs. Nothing else to install.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run supabase.sql first, then re-run this file';
  end if;
end;
$$;

-- ============================================================
-- 1. Catalog + tunables (public read, admin-only write)
-- ============================================================

create table if not exists public.mining_config (
  id                 int primary key default 1 check (id = 1),
  usd_per_ghs_day    numeric not null default 0.00105,   -- gross output per GH/s per day
  maintenance_pct    numeric not null default 8,         -- electricity + pool fee
  invest_boost_min_usd numeric not null default 10,      -- min purchase price that unlocks the permanent boost
  invest_boost_pct   numeric not null default 20,        -- permanent +% on qualifying ($10+) contracts
  custom_min_ghs     int     not null default 100,
  custom_max_ghs     int     not null default 20000,
  custom_min_days    int     not null default 7,
  custom_max_days    int     not null default 365,
  custom_base_days   int     not null default 30,
  min_claim_usdt     numeric not null default 0.05,
  points_bonus_pct   numeric not null default 10,
  boost_pct          numeric not null default 25,
  boost_hours        int     not null default 8,
  boost_cooldown_h   int     not null default 24,
  points_per_usdt    int     not null default 1000,
  updated_at         timestamptz not null default now()
);

insert into public.mining_config (id) values (1) on conflict (id) do nothing;

-- Keep older installs in sync: add the invest-boost tunables if missing and
-- bump either previous shipped default to the current rate. A custom admin
-- rate is deliberately left untouched.
alter table public.mining_config add column if not exists invest_boost_min_usd numeric not null default 10;
alter table public.mining_config add column if not exists invest_boost_pct     numeric not null default 20;
update public.mining_config
   set usd_per_ghs_day = 0.00105, updated_at = now()
 where id = 1 and usd_per_ghs_day in (0.000826, 0.00095);

create table if not exists public.mining_plans (
  key        text primary key,
  name       text    not null,
  tag        text    not null default '',
  ghs        int     not null check (ghs > 0),
  days       int     not null check (days > 0),
  price_usd  numeric not null default 0 check (price_usd >= 0),
  color      text    not null default '#7c3aed',
  is_free    boolean not null default false,
  featured   boolean not null default false,
  perks      text[]  not null default '{}',
  sort       int     not null default 0,
  active     boolean not null default true
);

insert into public.mining_plans (key, name, tag, ghs, days, price_usd, color, is_free, featured, perks, sort) values
  ('free',    'Free Starter Rig',     'FREE',      30,    7,   0,   '#34e5a5', true,  false,
     array['No payment needed','Renewable when it expires','Mined rewards land in your wallet'], 1),
  ('bronze',  'Bronze Miner',         'STARTER',   260,   30,  5,   '#ff8a3d', false, false,
     array['260 GH/s dedicated hashrate','30 day contract','Pay with points or USDT'], 2),
  ('emerald', 'Emerald Miner',        'GROWTH',    450,   45,  10,  '#10b981', false, false,
     array['450 GH/s dedicated hashrate','45 day contract','+20% invest boost (locked in for the full term)'], 3),
  ('silver',  'Silver Rig',           'POPULAR',   620,   60,  20,  '#22d3ee', false, true,
     array['620 GH/s hashrate — cheaper per GH/s than Bronze','60 day contract','+20% invest boost (locked in for the full term)'], 4),
  ('gold',    'Gold Farm',            'PRO',      1100,   90,  50,  '#ffd166', false, false,
     array['1,100 GH/s hashrate','90 day contract + priority payout queue','+20% invest boost (locked in for the full term)'], 5),
  ('titan',   'Titan Data Center',    'WHALE',    2000,  180, 150,  '#a970ff', false, false,
     array['2,000 GH/s high-output hashrate','180 day contract','+20% invest boost (locked in for the full term)'], 6),
  ('diamond', 'Diamond Mining Farm',  '$5+ DAILY', 6000,  120, 300,  '#3b82f6', false, false,
     array['6 TH/s premium hashrate','Estimated earnings above $5/day','+20% invest boost (locked in for the full term)'], 7),
  ('quantum', 'Quantum Data Center',  'MAX POWER',12000,  180, 750,  '#ec4899', false, false,
     array['12 TH/s — highest catalog hashrate','Estimated earnings above $10/day','+20% invest boost (locked in for the full term)'], 8)
on conflict (key) do update set
  name = excluded.name, tag = excluded.tag, ghs = excluded.ghs, days = excluded.days,
  price_usd = excluded.price_usd, color = excluded.color, is_free = excluded.is_free,
  featured = excluded.featured, perks = excluded.perks, sort = excluded.sort;

-- Volume pricing for the custom rig builder: price of 1 GH/s for a
-- `custom_base_days` term, cheaper as the rig gets bigger.
create table if not exists public.mining_custom_tiers (
  up_to       int     primary key,
  usd_per_ghs numeric not null check (usd_per_ghs > 0)
);

insert into public.mining_custom_tiers (up_to, usd_per_ghs) values
  (500, 0.020), (2000, 0.0185), (2147483647, 0.017)
on conflict (up_to) do update set usd_per_ghs = excluded.usd_per_ghs;

-- ============================================================
-- 2. Per-user state (own-row read only, never browser-writable)
-- ============================================================

-- Server-side spendable balance. Credited by an admin (deposits, approved
-- payouts, point migrations) or by mining claims — never by the browser.
create table if not exists public.balances (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  usdt       numeric not null default 0 check (usdt >= 0),
  points     bigint  not null default 0 check (points >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.mining_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  unclaimed   numeric not null default 0 check (unclaimed >= 0),
  claimed     numeric not null default 0 check (claimed >= 0),
  last_accrue timestamptz not null default now(),
  boost_until timestamptz,
  last_boost  timestamptz
);

create table if not exists public.mining_contracts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  plan        text not null,
  name        text not null,
  ghs         int  not null check (ghs > 0),
  days        int  not null check (days > 0),
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  price_usd   numeric not null default 0,
  paid_with   text    not null check (paid_with in ('usdt', 'points', 'free')),
  paid_amount numeric not null default 0,
  earned      numeric not null default 0,
  status      text    not null default 'active' check (status in ('active', 'expired'))
);

create index if not exists mining_contracts_user_idx on public.mining_contracts (user_id, status);

create table if not exists public.mining_ledger (
  id      bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type    text not null,
  detail  text not null default '',
  amount  numeric not null default 0,
  at      timestamptz not null default now()
);

create index if not exists mining_ledger_user_idx on public.mining_ledger (user_id, at desc);

-- ============================================================
-- 3. Internal helpers
-- ============================================================

-- Net output per GH/s per day after maintenance + pool fee.
create or replace function public.mining_net_rate()
returns numeric language sql stable security definer set search_path = public as $$
  select usd_per_ghs_day * (1 - maintenance_pct / 100.0) from public.mining_config where id = 1;
$$;

create or replace function public.mining_custom_price(p_ghs int, p_days int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare cfg public.mining_config; v_rate numeric;
begin
  select * into cfg from public.mining_config where id = 1;
  select usd_per_ghs into v_rate from public.mining_custom_tiers
    where up_to >= p_ghs order by up_to asc limit 1;
  if v_rate is null then
    select usd_per_ghs into v_rate from public.mining_custom_tiers order by up_to desc limit 1;
  end if;
  return round(p_ghs * v_rate * (p_days::numeric / cfg.custom_base_days), 2);
end;
$$;

-- Accrue every active contract up to now(). Idempotent: it can be called as
-- often as you like, the elapsed window is always [last_accrue, now).
create or replace function public.mining_accrue(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cfg  public.mining_config;
  acc  public.mining_accounts;
  c    public.mining_contracts;
  v_now  timestamptz := now();
  v_rate numeric;
  v_c_rate numeric;
  v_from timestamptz;
  v_to   timestamptz;
  v_boost_to timestamptz;
  v_amt  numeric;
  v_gain numeric := 0;
begin
  select * into cfg from public.mining_config where id = 1;
  insert into public.mining_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into acc from public.mining_accounts where user_id = p_user for update;

  v_rate := cfg.usd_per_ghs_day * (1 - cfg.maintenance_pct / 100.0);

  for c in select * from public.mining_contracts
           where user_id = p_user and status = 'active' for update loop
    -- permanent +invest_boost_pct% for contracts bought for $invest_boost_min_usd+
    v_c_rate := v_rate * (case when c.price_usd >= cfg.invest_boost_min_usd
                               then 1 + cfg.invest_boost_pct / 100.0 else 1 end);
    v_from := greatest(acc.last_accrue, c.started_at);
    v_to   := least(v_now, c.ends_at);
    if v_to > v_from then
      v_amt := (extract(epoch from (v_to - v_from)) / 86400.0) * c.ghs * v_c_rate;
      v_boost_to := least(v_to, coalesce(acc.boost_until, to_timestamp(0)));
      if v_boost_to > v_from then
        v_amt := v_amt + (extract(epoch from (v_boost_to - v_from)) / 86400.0)
                         * c.ghs * v_c_rate * (cfg.boost_pct / 100.0);
      end if;
      v_amt := round(v_amt, 8);
      update public.mining_contracts set earned = earned + v_amt where id = c.id;
      v_gain := v_gain + v_amt;
    end if;
    if v_now >= c.ends_at then
      update public.mining_contracts set status = 'expired' where id = c.id;
    end if;
  end loop;

  update public.mining_accounts
     set unclaimed = round(unclaimed + v_gain, 8), last_accrue = v_now
   where user_id = p_user;
end;
$$;

revoke all on function public.mining_accrue(uuid) from public, anon, authenticated;

-- Debit the caller's server balance. Prices are always passed in by the
-- calling RPC after it recomputed them from the catalog, never by a browser.
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

  if bal.usdt < p_price then
    raise exception 'Need % USDT — you have %', round(p_price, 2), round(bal.usdt, 2) using errcode = 'P0001';
  end if;
  update public.balances set usdt = usdt - p_price, updated_at = now() where user_id = p_user;
  return jsonb_build_object('paid_with', 'usdt', 'paid_amount', p_price);
end;
$$;

revoke all on function public.mining_charge(uuid, numeric, text, text) from public, anon, authenticated;

create or replace function public.mining_log(p_user uuid, p_type text, p_detail text, p_amount numeric)
returns void language sql security definer set search_path = public as $$
  insert into public.mining_ledger (user_id, type, detail, amount)
  values (p_user, p_type, p_detail, coalesce(p_amount, 0));
$$;

revoke all on function public.mining_log(uuid, text, text, numeric) from public, anon, authenticated;

create or replace function public.mining_require_user()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Please log in to use cloud mining' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- ============================================================
-- 4. Public RPC — everything a browser is allowed to do
-- ============================================================

-- Full snapshot: catalog, config, balances, contracts, ledger, stats.
create or replace function public.mining_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  cfg public.mining_config;
  acc public.mining_accounts;
  bal public.balances;
  v_ghs bigint;
  v_rate numeric;
  v_base_day numeric;
  v_boosted boolean;
begin
  perform public.mining_accrue(v_user);

  select * into cfg from public.mining_config where id = 1;
  select * into acc from public.mining_accounts where user_id = v_user;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user;

  select coalesce(sum(ghs), 0) into v_ghs from public.mining_contracts
    where user_id = v_user and status = 'active' and ends_at > now();

  v_rate := cfg.usd_per_ghs_day * (1 - cfg.maintenance_pct / 100.0);
  v_boosted := coalesce(acc.boost_until, to_timestamp(0)) > now();

  -- base daily output including the permanent +20% invest boost per contract
  select coalesce(sum(ghs * v_rate * (case when price_usd >= cfg.invest_boost_min_usd
                                           then 1 + cfg.invest_boost_pct / 100.0 else 1 end)), 0)
    into v_base_day from public.mining_contracts
    where user_id = v_user and status = 'active' and ends_at > now();

  return jsonb_build_object(
    'server', true,
    'now', extract(epoch from now()) * 1000,
    'config', to_jsonb(cfg) || jsonb_build_object(
      'netRate', v_rate,
      'customTiers', (select coalesce(jsonb_agg(jsonb_build_object('upTo', up_to, 'usdPerGhs', usd_per_ghs) order by up_to), '[]'::jsonb)
                        from public.mining_custom_tiers)
    ),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', key, 'name', name, 'tag', tag, 'ghs', ghs, 'days', days,
                'priceUsd', price_usd, 'color', color, 'free', is_free,
                'featured', featured, 'perks', perks) order by sort), '[]'::jsonb)
              from public.mining_plans where active),
    'balances', jsonb_build_object('usdt', bal.usdt, 'points', bal.points),
    'account', jsonb_build_object(
      'unclaimed', acc.unclaimed, 'claimed', acc.claimed,
      'lastAccrue', extract(epoch from acc.last_accrue) * 1000,
      'boostUntil', coalesce(extract(epoch from acc.boost_until) * 1000, 0),
      'lastBoost', coalesce(extract(epoch from acc.last_boost) * 1000, 0),
      'boosted', v_boosted,
      'ghs', v_ghs,
      'perDay', v_base_day * (case when v_boosted then 1 + cfg.boost_pct / 100.0 else 1 end)
    ),
    'contracts', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', id, 'plan', plan, 'name', name, 'ghs', ghs, 'days', days,
                    'startedAt', extract(epoch from started_at) * 1000,
                    'endsAt', extract(epoch from ends_at) * 1000,
                    'priceUsd', price_usd, 'paidWith', paid_with, 'paidAmount', paid_amount,
                    'earned', earned,
                    'status', case when status = 'active' and ends_at > now() then 'active' else 'expired' end
                  ) order by started_at desc), '[]'::jsonb)
                  from public.mining_contracts where user_id = v_user),
    'log', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', id, 'type', type, 'text', detail, 'amount', amount,
              'at', extract(epoch from at) * 1000) order by at desc), '[]'::jsonb)
            from (select * from public.mining_ledger where user_id = v_user
                  order by at desc limit 120) l)
  );
end;
$$;

-- Buy a catalog plan. The client sends only the plan key + currency; the
-- hashrate, term and price all come from public.mining_plans.
create or replace function public.mining_buy_plan(p_plan text, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  p public.mining_plans;
  v_paid jsonb;
begin
  perform public.mining_accrue(v_user);

  select * into p from public.mining_plans where key = p_plan and active;
  if not found then raise exception 'Unknown mining plan' using errcode = 'P0001'; end if;

  if p.is_free and exists (
    select 1 from public.mining_contracts
     where user_id = v_user and plan = p.key and status = 'active' and ends_at > now()
  ) then
    raise exception 'Your free starter rig is already running — renew it when it expires' using errcode = 'P0001';
  end if;

  v_paid := public.mining_charge(v_user, p.price_usd, p_currency,
                                 'Hashrate purchase — ' || p.name);

  insert into public.mining_contracts (user_id, plan, name, ghs, days, ends_at, price_usd, paid_with, paid_amount)
  values (v_user, p.key, p.name, p.ghs, p.days, now() + (p.days || ' days')::interval,
          p.price_usd, v_paid ->> 'paid_with', (v_paid ->> 'paid_amount')::numeric);

  perform public.mining_log(v_user, 'buy',
    'Started ' || p.name || ' · ' || p.ghs || ' GH/s for ' || p.days || ' days', -p.price_usd);

  return public.mining_state();
end;
$$;

-- Build a custom rig. The price is recomputed from the volume tiers, so a
-- tampered client price is irrelevant.
create or replace function public.mining_buy_custom(p_ghs int, p_days int, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  cfg public.mining_config;
  v_price numeric;
  v_paid jsonb;
begin
  perform public.mining_accrue(v_user);
  select * into cfg from public.mining_config where id = 1;

  if p_ghs is null or p_ghs < cfg.custom_min_ghs then
    raise exception 'Minimum custom hashrate is % GH/s', cfg.custom_min_ghs using errcode = 'P0001';
  end if;
  if p_ghs > cfg.custom_max_ghs then
    raise exception 'Maximum custom hashrate is % GH/s', cfg.custom_max_ghs using errcode = 'P0001';
  end if;
  if p_days is null or p_days < cfg.custom_min_days or p_days > cfg.custom_max_days then
    raise exception 'Contract length must be between % and % days', cfg.custom_min_days, cfg.custom_max_days using errcode = 'P0001';
  end if;

  v_price := public.mining_custom_price(p_ghs, p_days);
  v_paid := public.mining_charge(v_user, v_price, p_currency, 'Hashrate purchase — custom rig');

  insert into public.mining_contracts (user_id, plan, name, ghs, days, ends_at, price_usd, paid_with, paid_amount)
  values (v_user, 'custom', 'Custom Rig', p_ghs, p_days, now() + (p_days || ' days')::interval,
          v_price, v_paid ->> 'paid_with', (v_paid ->> 'paid_amount')::numeric);

  perform public.mining_log(v_user, 'buy',
    'Started a custom rig · ' || p_ghs || ' GH/s for ' || p_days || ' days', -v_price);

  return public.mining_state();
end;
$$;

-- Claim the mined balance into the server USDT balance, or as points with a
-- bonus. The amount comes from mining_accounts, never from the client.
create or replace function public.mining_claim(p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  cfg public.mining_config;
  acc public.mining_accounts;
  v_amount numeric;
  v_points bigint;
begin
  perform public.mining_accrue(v_user);
  select * into cfg from public.mining_config where id = 1;
  select * into acc from public.mining_accounts where user_id = v_user for update;

  v_amount := round(acc.unclaimed, 6);
  if v_amount < cfg.min_claim_usdt then
    raise exception 'Minimum claim is $% — keep mining a little longer', cfg.min_claim_usdt using errcode = 'P0001';
  end if;

  update public.mining_accounts
     set unclaimed = 0, claimed = round(claimed + v_amount, 8)
   where user_id = v_user;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;

  if p_mode = 'points' then
    v_points := floor(v_amount * cfg.points_per_usdt * (1 + cfg.points_bonus_pct / 100.0));
    update public.balances set points = points + v_points, updated_at = now() where user_id = v_user;
    perform public.mining_log(v_user, 'claim',
      'Claimed $' || round(v_amount, 4) || ' as ' || v_points || ' points', v_amount);
  else
    update public.balances set usdt = round(usdt + v_amount, 8), updated_at = now() where user_id = v_user;
    perform public.mining_log(v_user, 'claim',
      'Claimed $' || round(v_amount, 4) || ' to the USDT balance', v_amount);
  end if;

  return public.mining_state();
end;
$$;

-- One free speed boost per cooldown window.
create or replace function public.mining_boost()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  cfg public.mining_config;
  acc public.mining_accounts;
  v_next timestamptz;
begin
  perform public.mining_accrue(v_user);
  select * into cfg from public.mining_config where id = 1;
  select * into acc from public.mining_accounts where user_id = v_user for update;

  if not exists (select 1 from public.mining_contracts
                 where user_id = v_user and status = 'active' and ends_at > now()) then
    raise exception 'Start a rig first — there is nothing to boost yet' using errcode = 'P0001';
  end if;

  v_next := coalesce(acc.last_boost, to_timestamp(0)) + (cfg.boost_cooldown_h || ' hours')::interval;
  if v_next > now() then
    raise exception 'Next free boost unlocks in %', date_trunc('minute', v_next - now()) using errcode = 'P0001';
  end if;

  update public.mining_accounts
     set boost_until = greatest(coalesce(boost_until, now()), now()) + (cfg.boost_hours || ' hours')::interval,
         last_boost = now()
   where user_id = v_user;

  perform public.mining_log(v_user, 'boost',
    '+' || cfg.boost_pct || '% speed boost for ' || cfg.boost_hours || ' hours', 0);

  return public.mining_state();
end;
$$;

-- ============================================================
-- 5. Admin RPC — credit / debit a member's server balance
-- ============================================================
-- Use this when you approve a USDT deposit, settle a withdrawal, or migrate
-- a member's browser points into the server ledger. Admin-gated by the same
-- public.admins allowlist used by the analytics dashboard.
create or replace function public.mining_admin_adjust(p_email text, p_usdt numeric, p_points bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; bal public.balances;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'No account for %', p_email using errcode = 'P0001'; end if;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.balances
     set usdt = round(usdt + coalesce(p_usdt, 0), 8),
         points = points + coalesce(p_points, 0),
         updated_at = now()
   where user_id = v_user
  returning * into bal;

  perform public.mining_log(v_user, 'admin',
    coalesce(nullif(p_note, ''), 'Balance adjusted by an admin'), coalesce(p_usdt, 0));

  return jsonb_build_object('email', lower(p_email), 'usdt', bal.usdt, 'points', bal.points);
end;
$$;

create or replace function public.mining_admin_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'miners', (select count(distinct user_id) from public.mining_contracts where status = 'active' and ends_at > now()),
    'poolGhs', (select coalesce(sum(ghs), 0) from public.mining_contracts where status = 'active' and ends_at > now()),
    'unclaimed', (select coalesce(sum(unclaimed), 0) from public.mining_accounts),
    'claimed', (select coalesce(sum(claimed), 0) from public.mining_accounts),
    'sold', (select coalesce(sum(price_usd), 0) from public.mining_contracts),
    'balances', jsonb_build_object(
      'usdt', (select coalesce(sum(usdt), 0) from public.balances),
      'points', (select coalesce(sum(points), 0) from public.balances)),
    'rows', (select coalesce(jsonb_agg(r order by r ->> 'email'), '[]'::jsonb) from (
      select jsonb_build_object(
        'email', u.email,
        'usdt', coalesce(b.usdt, 0),
        'points', coalesce(b.points, 0),
        'ghs', coalesce((select sum(c.ghs) from public.mining_contracts c
                          where c.user_id = u.id and c.status = 'active' and c.ends_at > now()), 0),
        'unclaimed', coalesce(a.unclaimed, 0),
        'claimed', coalesce(a.claimed, 0)
      ) as r
      from auth.users u
      left join public.balances b on b.user_id = u.id
      left join public.mining_accounts a on a.user_id = u.id
      where b.user_id is not null or a.user_id is not null
      limit 500) s)
  );
end;
$$;

-- ============================================================
-- 6. Row level security
-- ============================================================

alter table public.mining_config       enable row level security;
alter table public.mining_plans        enable row level security;
alter table public.mining_custom_tiers enable row level security;
alter table public.balances            enable row level security;
alter table public.mining_accounts     enable row level security;
alter table public.mining_contracts    enable row level security;
alter table public.mining_ledger       enable row level security;

drop policy if exists "anyone can read mining config"  on public.mining_config;
drop policy if exists "anyone can read mining plans"   on public.mining_plans;
drop policy if exists "anyone can read mining tiers"   on public.mining_custom_tiers;
drop policy if exists "members read own balance"       on public.balances;
drop policy if exists "members read own mining account" on public.mining_accounts;
drop policy if exists "members read own contracts"     on public.mining_contracts;
drop policy if exists "members read own mining log"    on public.mining_ledger;
drop policy if exists "admins read all balances"       on public.balances;
drop policy if exists "admins read all contracts"      on public.mining_contracts;
drop policy if exists "admins read all mining accounts" on public.mining_accounts;
drop policy if exists "admins read all mining logs"    on public.mining_ledger;

-- The catalog is public so the pricing page works for logged-out visitors.
create policy "anyone can read mining config" on public.mining_config
  for select to anon, authenticated using (true);
create policy "anyone can read mining plans" on public.mining_plans
  for select to anon, authenticated using (active);
create policy "anyone can read mining tiers" on public.mining_custom_tiers
  for select to anon, authenticated using (true);

-- Members may read their own rows and nothing else.
create policy "members read own balance" on public.balances
  for select to authenticated using (user_id = auth.uid());
create policy "members read own mining account" on public.mining_accounts
  for select to authenticated using (user_id = auth.uid());
create policy "members read own contracts" on public.mining_contracts
  for select to authenticated using (user_id = auth.uid());
create policy "members read own mining log" on public.mining_ledger
  for select to authenticated using (user_id = auth.uid());

create policy "admins read all balances" on public.balances
  for select to authenticated using (public.is_admin());
create policy "admins read all contracts" on public.mining_contracts
  for select to authenticated using (public.is_admin());

-- The admin panel's per-member view (click an email on admin.html) reads the
-- member's mining stats and coin activity feed, so admins see those too.
create policy "admins read all mining accounts" on public.mining_accounts
  for select to authenticated using (public.is_admin());
create policy "admins read all mining logs" on public.mining_ledger
  for select to authenticated using (public.is_admin());

-- Deliberately NO insert / update / delete policy on any mining table:
-- the only write path is through the security-definer RPCs above.
revoke insert, update, delete on
  public.mining_config, public.mining_plans, public.mining_custom_tiers,
  public.balances, public.mining_accounts, public.mining_contracts, public.mining_ledger
  from anon, authenticated;

-- ============================================================
-- 7. Grants
-- ============================================================

revoke all on function public.mining_state()                                   from public, anon;
revoke all on function public.mining_buy_plan(text, text)                      from public, anon;
revoke all on function public.mining_buy_custom(int, int, text)                from public, anon;
revoke all on function public.mining_claim(text)                               from public, anon;
revoke all on function public.mining_boost()                                   from public, anon;
revoke all on function public.mining_admin_adjust(text, numeric, bigint, text) from public, anon;
revoke all on function public.mining_admin_overview()                          from public, anon;

grant execute on function public.mining_state()                                   to authenticated;
grant execute on function public.mining_buy_plan(text, text)                      to authenticated;
grant execute on function public.mining_buy_custom(int, int, text)                to authenticated;
grant execute on function public.mining_claim(text)                               to authenticated;
grant execute on function public.mining_boost()                                   to authenticated;
grant execute on function public.mining_admin_adjust(text, numeric, bigint, text) to authenticated;
grant execute on function public.mining_admin_overview()                          to authenticated;

-- The custom price helper is safe to expose (read-only, catalog derived).
grant execute on function public.mining_custom_price(int, int) to anon, authenticated;
grant execute on function public.mining_net_rate()             to anon, authenticated;
