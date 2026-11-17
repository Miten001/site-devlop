-- =========================================================================
-- FlexFam — Rewards Hub & Public Showcase Profile (Migration #28)
-- =========================================================================
-- Adds 5 connected server-verified features:
--   1. Weekly Leaderboard & Prize Pool (Top Earners / Taskers / Referrers)
--   2. Lucky Spin / Daily Wheel (free daily + task bonus + optional 25-pt spin)
--   3. Promo / Redeem Gift Codes (admin manager + atomic member redemptions)
--   4. VIP Membership Tiers (Bronze -> Diamond XP ladder, daily bonus, spin boost)
--   5. Public Member Profile & Showcase Card (anon-readable safe stats card)
--
-- Depends on: #1 (supabase.sql), #2 (supabase-mining.sql), #3 (supabase-wallet.sql)
-- Optional:   #5 (campaigns), #14 (daily streak), #16 (referrals), #27 (quests)
-- Safe to re-run (fully idempotent).
-- =========================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- 1. Tables + RLS
-- -------------------------------------------------------------------------

create table if not exists public.spin_logs (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  spin_day       text not null,
  paid           boolean not null default false,
  segment_id     text not null,
  label          text not null,
  reward_type    text not null check (reward_type in ('points', 'usdt')),
  base_amount    numeric not null check (base_amount >= 0),
  multiplier     numeric not null default 1,
  reward_amount  numeric not null check (reward_amount >= 0),
  spun_at        timestamptz not null default now()
);
create index if not exists spin_logs_user_day_idx on public.spin_logs (user_id, spin_day, spun_at desc);

alter table public.spin_logs enable row level security;
drop policy if exists "spin_logs_read_own" on public.spin_logs;
create policy "spin_logs_read_own" on public.spin_logs
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create table if not exists public.promo_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  title          text not null default '',
  reward_type    text not null check (reward_type in ('points', 'usdt')),
  reward_amount  numeric not null check (reward_amount > 0),
  max_uses       integer not null default 0 check (max_uses >= 0),
  used_count     integer not null default 0 check (used_count >= 0),
  active         boolean not null default true,
  expires_at     timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists promo_codes_active_idx on public.promo_codes (active, created_at desc);

alter table public.promo_codes enable row level security;
drop policy if exists "promo_codes_admin_only" on public.promo_codes;
create policy "promo_codes_admin_only" on public.promo_codes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.promo_redemptions (
  id             bigserial primary key,
  code_id        uuid not null references public.promo_codes(id) on delete cascade,
  code           text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  reward_type    text not null check (reward_type in ('points', 'usdt')),
  reward_amount  numeric not null check (reward_amount > 0),
  redeemed_at    timestamptz not null default now(),
  constraint promo_redemptions_once unique (code_id, user_id)
);
create index if not exists promo_redemptions_user_idx on public.promo_redemptions (user_id, redeemed_at desc);

alter table public.promo_redemptions enable row level security;
drop policy if exists "promo_redemptions_read_own" on public.promo_redemptions;
create policy "promo_redemptions_read_own" on public.promo_redemptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create table if not exists public.vip_daily_claims (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  claim_day      text not null,
  tier_id        text not null,
  reward_type    text not null check (reward_type in ('points', 'usdt')),
  reward_amount  numeric not null check (reward_amount > 0),
  claimed_at     timestamptz not null default now(),
  constraint vip_daily_claims_once unique (user_id, claim_day)
);
create index if not exists vip_daily_claims_user_idx on public.vip_daily_claims (user_id, claimed_at desc);

alter table public.vip_daily_claims enable row level security;
drop policy if exists "vip_daily_claims_read_own" on public.vip_daily_claims;
create policy "vip_daily_claims_read_own" on public.vip_daily_claims
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create table if not exists public.leaderboard_claims (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  week_key       text not null,
  category       text not null check (category in ('earners', 'taskers', 'referrers')),
  rank           integer not null check (rank between 1 and 3),
  reward_type    text not null check (reward_type in ('points', 'usdt')),
  reward_amount  numeric not null check (reward_amount > 0),
  claimed_at     timestamptz not null default now(),
  constraint leaderboard_claims_once unique (user_id, week_key, category)
);
create index if not exists leaderboard_claims_user_idx on public.leaderboard_claims (user_id, claimed_at desc);

alter table public.leaderboard_claims enable row level security;
drop policy if exists "leaderboard_claims_read_own" on public.leaderboard_claims;
create policy "leaderboard_claims_read_own" on public.leaderboard_claims
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Seed one welcome promo code (idempotent; admins can edit, pause or delete it)
insert into public.promo_codes (code, title, reward_type, reward_amount, max_uses, active)
values ('FLEXWELCOME', 'Welcome gift code', 'points', 50, 500, true)
on conflict (code) do nothing;

-- -------------------------------------------------------------------------
-- 2. VIP Tier Engine
-- -------------------------------------------------------------------------

create or replace function public.vip_profile_calc(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp_done     bigint := 0;
  v_job_done      bigint := 0;
  v_total_tasks   bigint := 0;
  v_best_streak   bigint := 0;
  v_cur_streak    bigint := 0;
  v_referrals     bigint := 0;
  v_mining_claims bigint := 0;
  v_quest_claims  bigint := 0;
  v_created_cnt   bigint := 0;
  v_xp            bigint := 0;
  v_tier_id       text := 'bronze';
  v_tier_name     text := 'Bronze';
  v_tier_icon     text := '🥉';
  v_tier_color    text := '#f59e0b';
  v_tier_index    int  := 0;
  v_free_spins    int  := 1;
  v_spin_mult     numeric := 1.0;
  v_daily_type    text := 'points';
  v_daily_amount  numeric := 10;
  v_min_xp        bigint := 0;
  v_next_xp       bigint := 250;
  v_next_name     text := 'Silver';
begin
  if to_regclass('public.market_campaign_subs') is not null then
    select count(*) into v_camp_done
      from public.market_campaign_subs
     where worker = p_user and status = 'approved';
  end if;

  if to_regclass('public.job_subs') is not null then
    select count(*) into v_job_done
      from public.job_subs
     where worker = p_user and status = 'approved';
  end if;

  v_total_tasks := coalesce(v_camp_done, 0) + coalesce(v_job_done, 0);

  if to_regclass('public.daily_streaks') is not null then
    select coalesce(streak, 0), greatest(coalesce(best, 0), coalesce(streak, 0))
      into v_cur_streak, v_best_streak
      from public.daily_streaks
     where user_id = p_user;
    v_cur_streak := coalesce(v_cur_streak, 0);
    v_best_streak := coalesce(v_best_streak, 0);
  end if;

  if to_regclass('public.referrals') is not null then
    select count(*) into v_referrals
      from public.referrals
     where referrer_user = p_user;
  end if;

  if to_regclass('public.mining_ledger') is not null then
    select count(*) into v_mining_claims
      from public.mining_ledger
     where user_id = p_user and type = 'claim';
  end if;

  if to_regclass('public.quest_claims') is not null then
    select count(*) into v_quest_claims
      from public.quest_claims
     where user_id = p_user;
  end if;

  if to_regclass('public.market_campaigns') is not null then
    select v_created_cnt + count(*) into v_created_cnt
      from public.market_campaigns
     where owner = p_user;
  end if;

  if to_regclass('public.jobs') is not null then
    select v_created_cnt + count(*) into v_created_cnt
      from public.jobs
     where owner = p_user;
  end if;

  v_xp := (v_total_tasks * 20)
        + (v_best_streak * 15)
        + (coalesce(v_referrals, 0) * 40)
        + (coalesce(v_mining_claims, 0) * 10)
        + (coalesce(v_quest_claims, 0) * 25);

  if v_xp >= 5000 then
    v_tier_id := 'diamond';  v_tier_name := 'Diamond';  v_tier_icon := '💎'; v_tier_color := '#38bdf8'; v_tier_index := 4;
    v_free_spins := 3; v_spin_mult := 2.0;  v_daily_type := 'usdt';   v_daily_amount := 0.12; v_min_xp := 5000; v_next_xp := null; v_next_name := null;
  elsif v_xp >= 2000 then
    v_tier_id := 'platinum'; v_tier_name := 'Platinum'; v_tier_icon := '👑'; v_tier_color := '#a855f7'; v_tier_index := 3;
    v_free_spins := 2; v_spin_mult := 1.5;  v_daily_type := 'usdt';   v_daily_amount := 0.05; v_min_xp := 2000; v_next_xp := 5000; v_next_name := 'Diamond';
  elsif v_xp >= 750 then
    v_tier_id := 'gold';     v_tier_name := 'Gold';     v_tier_icon := '🥇'; v_tier_color := '#ffd166'; v_tier_index := 2;
    v_free_spins := 2; v_spin_mult := 1.25; v_daily_type := 'usdt';   v_daily_amount := 0.02; v_min_xp := 750;  v_next_xp := 2000; v_next_name := 'Platinum';
  elsif v_xp >= 250 then
    v_tier_id := 'silver';   v_tier_name := 'Silver';   v_tier_icon := '🥈'; v_tier_color := '#cbd5e1'; v_tier_index := 1;
    v_free_spins := 1; v_spin_mult := 1.1;  v_daily_type := 'points'; v_daily_amount := 25;   v_min_xp := 250;  v_next_xp := 750;  v_next_name := 'Gold';
  else
    v_tier_id := 'bronze';   v_tier_name := 'Bronze';   v_tier_icon := '🥉'; v_tier_color := '#f59e0b'; v_tier_index := 0;
    v_free_spins := 1; v_spin_mult := 1.0;  v_daily_type := 'points'; v_daily_amount := 10;   v_min_xp := 0;    v_next_xp := 250;  v_next_name := 'Silver';
  end if;

  return jsonb_build_object(
    'tierId',      v_tier_id,
    'tierName',    v_tier_name,
    'tierIcon',    v_tier_icon,
    'tierColor',   v_tier_color,
    'tierIndex',   v_tier_index,
    'xp',          v_xp,
    'minXp',       v_min_xp,
    'nextXp',      v_next_xp,
    'nextName',    v_next_name,
    'freeSpins',   v_free_spins,
    'spinMult',    v_spin_mult,
    'dailyType',   v_daily_type,
    'dailyAmount', v_daily_amount,
    'breakdown', jsonb_build_object(
      'totalTasks',   v_total_tasks,
      'currentStreak', v_cur_streak,
      'bestStreak',   v_best_streak,
      'referrals',    coalesce(v_referrals, 0),
      'miningClaims', coalesce(v_mining_claims, 0),
      'questClaims',  coalesce(v_quest_claims, 0),
      'createdCount', coalesce(v_created_cnt, 0)
    )
  );
end;
$$;

create or replace function public.vip_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := public.wallet_require_user();
  v_today    text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_next_utc timestamptz := (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC';
  v_calc     jsonb := public.vip_profile_calc(v_user);
  v_claimed  boolean := false;
  v_recent   jsonb := '[]'::jsonb;
begin
  select exists(
    select 1 from public.vip_daily_claims
     where user_id = v_user and claim_day = v_today
  ) into v_claimed;

  select coalesce(jsonb_agg(jsonb_build_object(
    'claimDay',     c.claim_day,
    'tierId',       c.tier_id,
    'rewardType',   c.reward_type,
    'rewardAmount', c.reward_amount,
    'claimedAt',    floor(extract(epoch from c.claimed_at) * 1000)::bigint
  ) order by c.claimed_at desc), '[]'::jsonb)
  into v_recent
  from (
    select * from public.vip_daily_claims
     where user_id = v_user
     order by claimed_at desc
     limit 10
  ) c;

  return v_calc || jsonb_build_object(
    'todayKey',     v_today,
    'utcResetAt',   floor(extract(epoch from v_next_utc) * 1000)::bigint,
    'claimedToday', v_claimed,
    'recentClaims', v_recent
  );
end;
$$;

create or replace function public.vip_claim_daily()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := public.wallet_require_user();
  v_today  text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_calc   jsonb;
  v_tier   text;
  v_name   text;
  v_rtype  text;
  v_amt    numeric;
  v_pts    bigint;
begin
  insert into public.balances (user_id) values (v_user)
  on conflict (user_id) do nothing;
  perform 1 from public.balances where user_id = v_user for update;

  if exists (
    select 1 from public.vip_daily_claims
     where user_id = v_user and claim_day = v_today
  ) then
    raise exception 'You already claimed today''s VIP bonus — come back after midnight UTC.'
      using errcode = 'P0001';
  end if;

  v_calc  := public.vip_profile_calc(v_user);
  v_tier  := v_calc->>'tierId';
  v_name  := v_calc->>'tierName';
  v_rtype := v_calc->>'dailyType';
  v_amt   := (v_calc->>'dailyAmount')::numeric;

  insert into public.vip_daily_claims (user_id, claim_day, tier_id, reward_type, reward_amount)
  values (v_user, v_today, v_tier, v_rtype, v_amt);

  if v_rtype = 'usdt' then
    update public.balances
       set usdt = round(coalesce(usdt, 0) + v_amt, 8),
           total_earned = round(coalesce(total_earned, 0) + v_amt, 8),
           updated_at = now()
     where user_id = v_user;
    perform public.wallet_tx(
      v_user, 'vip_bonus', v_amt,
      'VIP ' || v_name || ' daily bonus',
      'completed', null, null
    );
  else
    v_pts := round(v_amt)::bigint;
    update public.balances
       set points = coalesce(points, 0) + v_pts,
           updated_at = now()
     where user_id = v_user;
  end if;

  return jsonb_build_object(
    'claimed', jsonb_build_object(
      'tierId',       v_tier,
      'tierName',     v_name,
      'rewardType',   v_rtype,
      'rewardAmount', v_amt
    ),
    'state', public.vip_state()
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 3. Lucky Spin / Daily Wheel
-- -------------------------------------------------------------------------

create or replace function public.spin_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := public.wallet_require_user();
  v_today       text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_day_start   timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_next_utc    timestamptz := (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC';
  v_vip         jsonb := public.vip_profile_calc(v_user);
  v_base_free   int := coalesce((v_vip->>'freeSpins')::int, 1);
  v_mult        numeric := coalesce((v_vip->>'spinMult')::numeric, 1.0);
  v_today_tasks bigint := 0;
  v_task_bonus  boolean := false;
  v_free_total  int;
  v_free_used   int := 0;
  v_paid_used   int := 0;
  v_points      bigint := 0;
  v_history     jsonb := '[]'::jsonb;
begin
  if to_regclass('public.market_campaign_subs') is not null then
    select v_today_tasks + count(*) into v_today_tasks
      from public.market_campaign_subs
     where worker = v_user and status = 'approved' and at >= v_day_start;
  end if;

  if to_regclass('public.job_subs') is not null then
    select v_today_tasks + count(*) into v_today_tasks
      from public.job_subs
     where worker = v_user and status = 'approved' and at >= v_day_start;
  end if;

  v_task_bonus := v_today_tasks >= 1;
  v_free_total := v_base_free + (case when v_task_bonus then 1 else 0 end);

  select
    coalesce(count(*) filter (where paid = false), 0)::int,
    coalesce(count(*) filter (where paid = true), 0)::int
  into v_free_used, v_paid_used
  from public.spin_logs
  where user_id = v_user and spin_day = v_today;

  select coalesce(points, 0) into v_points
    from public.balances
   where user_id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           s.id,
    'segmentId',    s.segment_id,
    'label',        s.label,
    'paid',         s.paid,
    'rewardType',   s.reward_type,
    'baseAmount',   s.base_amount,
    'multiplier',   s.multiplier,
    'rewardAmount', s.reward_amount,
    'spunAt',       floor(extract(epoch from s.spun_at) * 1000)::bigint
  ) order by s.spun_at desc), '[]'::jsonb)
  into v_history
  from (
    select * from public.spin_logs
     where user_id = v_user
     order by spun_at desc
     limit 15
  ) s;

  return jsonb_build_object(
    'todayKey',          v_today,
    'utcResetAt',        floor(extract(epoch from v_next_utc) * 1000)::bigint,
    'vipTier',           v_vip->>'tierId',
    'vipName',           v_vip->>'tierName',
    'vipIcon',           v_vip->>'tierIcon',
    'spinMult',          v_mult,
    'baseFreeSpins',     v_base_free,
    'taskBonusUnlocked', v_task_bonus,
    'freeTotal',         v_free_total,
    'freeUsed',          v_free_used,
    'freeLeft',          greatest(0, v_free_total - v_free_used),
    'paidUsed',          v_paid_used,
    'paidMax',           2,
    'paidLeft',          greatest(0, 2 - v_paid_used),
    'paidCostPts',       25,
    'points',            coalesce(v_points, 0),
    'history',           v_history
  );
end;
$$;

create or replace function public.spin_play(p_use_points boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := public.wallet_require_user();
  v_today       text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  v_day_start   timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_vip         jsonb;
  v_base_free   int;
  v_mult        numeric;
  v_today_tasks bigint := 0;
  v_free_total  int;
  v_free_used   int := 0;
  v_paid_used   int := 0;
  v_bal_pts     bigint := 0;
  v_paid        boolean := coalesce(p_use_points, false);
  v_roll        numeric;
  v_seg_idx     int;
  v_seg_id      text;
  v_label       text;
  v_rtype       text;
  v_base        numeric;
  v_final       numeric;
  v_pts_add     bigint;
begin
  insert into public.balances (user_id) values (v_user)
  on conflict (user_id) do nothing;
  select coalesce(points, 0) into v_bal_pts
    from public.balances
   where user_id = v_user
   for update;

  v_vip := public.vip_profile_calc(v_user);
  v_base_free := coalesce((v_vip->>'freeSpins')::int, 1);
  v_mult := coalesce((v_vip->>'spinMult')::numeric, 1.0);

  if to_regclass('public.market_campaign_subs') is not null then
    select v_today_tasks + count(*) into v_today_tasks
      from public.market_campaign_subs
     where worker = v_user and status = 'approved' and at >= v_day_start;
  end if;
  if to_regclass('public.job_subs') is not null then
    select v_today_tasks + count(*) into v_today_tasks
      from public.job_subs
     where worker = v_user and status = 'approved' and at >= v_day_start;
  end if;

  v_free_total := v_base_free + (case when v_today_tasks >= 1 then 1 else 0 end);

  select
    coalesce(count(*) filter (where paid = false), 0)::int,
    coalesce(count(*) filter (where paid = true), 0)::int
  into v_free_used, v_paid_used
  from public.spin_logs
  where user_id = v_user and spin_day = v_today;

  if not v_paid then
    if v_free_used >= v_free_total then
      raise exception 'No free spins left today — complete a task or use 25 points for an extra spin.'
        using errcode = 'P0001';
    end if;
  else
    if v_paid_used >= 2 then
      raise exception 'Daily extra spin limit (2) reached — come back after midnight UTC.'
        using errcode = 'P0001';
    end if;
    if v_bal_pts < 25 then
      raise exception 'You need 25 points for an extra spin.'
        using errcode = 'P0001';
    end if;
    update public.balances
       set points = greatest(0, coalesce(points, 0) - 25),
           updated_at = now()
     where user_id = v_user;
  end if;

  v_roll := random() * 100.0;
  if v_roll < 28 then
    v_seg_idx := 0; v_seg_id := 'pts_10';  v_label := '+10 pts';    v_rtype := 'points'; v_base := 10;
  elsif v_roll < 50 then
    v_seg_idx := 1; v_seg_id := 'pts_25';  v_label := '+25 pts';    v_rtype := 'points'; v_base := 25;
  elsif v_roll < 65 then
    v_seg_idx := 2; v_seg_id := 'pts_50';  v_label := '+50 pts';    v_rtype := 'points'; v_base := 50;
  elsif v_roll < 73 then
    v_seg_idx := 3; v_seg_id := 'pts_100'; v_label := '+100 pts';   v_rtype := 'points'; v_base := 100;
  elsif v_roll < 85 then
    v_seg_idx := 4; v_seg_id := 'usdt_01'; v_label := '$0.01 USDT'; v_rtype := 'usdt';   v_base := 0.01;
  elsif v_roll < 93 then
    v_seg_idx := 5; v_seg_id := 'usdt_02'; v_label := '$0.02 USDT'; v_rtype := 'usdt';   v_base := 0.02;
  elsif v_roll < 98 then
    v_seg_idx := 6; v_seg_id := 'usdt_05'; v_label := '$0.05 USDT'; v_rtype := 'usdt';   v_base := 0.05;
  else
    v_seg_idx := 7; v_seg_id := 'jackpot'; v_label := '$0.15 JACKPOT'; v_rtype := 'usdt'; v_base := 0.15;
  end if;

  if v_rtype = 'points' then
    v_pts_add := greatest(1, round(v_base * v_mult)::bigint);
    v_final := v_pts_add;
    update public.balances
       set points = coalesce(points, 0) + v_pts_add,
           updated_at = now()
     where user_id = v_user;
  else
    v_final := round(v_base * v_mult, 4);
    update public.balances
       set usdt = round(coalesce(usdt, 0) + v_final, 8),
           total_earned = round(coalesce(total_earned, 0) + v_final, 8),
           updated_at = now()
     where user_id = v_user;
    perform public.wallet_tx(
      v_user, 'lucky_spin', v_final,
      'Lucky Spin win: ' || v_label || (case when v_mult > 1 then ' (' || v_mult || 'x VIP)' else '' end),
      'completed', null, null
    );
  end if;

  insert into public.spin_logs (
    user_id, spin_day, paid, segment_id, label,
    reward_type, base_amount, multiplier, reward_amount
  ) values (
    v_user, v_today, v_paid, v_seg_id, v_label,
    v_rtype, v_base, v_mult, v_final
  );

  return jsonb_build_object(
    'spin', jsonb_build_object(
      'segmentIndex', v_seg_idx,
      'segmentId',    v_seg_id,
      'label',        v_label,
      'paid',         v_paid,
      'rewardType',   v_rtype,
      'baseAmount',   v_base,
      'multiplier',   v_mult,
      'rewardAmount', v_final
    ),
    'state', public.spin_state()
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 4. Promo / Gift Codes (Member + Admin RPCs)
-- -------------------------------------------------------------------------

create or replace function public.promo_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := public.wallet_require_user();
  v_items jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'code',         r.code,
    'rewardType',   r.reward_type,
    'rewardAmount', r.reward_amount,
    'redeemedAt',   floor(extract(epoch from r.redeemed_at) * 1000)::bigint
  ) order by r.redeemed_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from public.promo_redemptions
     where user_id = v_user
     order by redeemed_at desc
     limit 25
  ) r;

  return jsonb_build_object('items', v_items);
end;
$$;

create or replace function public.promo_redeem(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.wallet_require_user();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_row  public.promo_codes;
  v_pts  bigint;
begin
  if v_code = '' or length(v_code) < 3 then
    raise exception 'Enter a valid gift code.' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.promo_codes
   where upper(code) = v_code
   for update;

  if not found then
    raise exception 'Gift code "%" was not found. Check the spelling and try again.', v_code
      using errcode = 'P0001';
  end if;

  if not v_row.active then
    raise exception 'Gift code "%" is currently paused.', v_row.code
      using errcode = 'P0001';
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    raise exception 'Gift code "%" has expired.', v_row.code
      using errcode = 'P0001';
  end if;

  if v_row.max_uses > 0 and v_row.used_count >= v_row.max_uses then
    raise exception 'Gift code "%" has reached its redemption limit.', v_row.code
      using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_user)
  on conflict (user_id) do nothing;
  perform 1 from public.balances where user_id = v_user for update;

  if exists (
    select 1 from public.promo_redemptions
     where code_id = v_row.id and user_id = v_user
  ) then
    raise exception 'You have already redeemed gift code "%".', v_row.code
      using errcode = 'P0001';
  end if;

  insert into public.promo_redemptions (code_id, code, user_id, reward_type, reward_amount)
  values (v_row.id, v_row.code, v_user, v_row.reward_type, v_row.reward_amount);

  update public.promo_codes
     set used_count = used_count + 1
   where id = v_row.id;

  if v_row.reward_type = 'usdt' then
    update public.balances
       set usdt = round(coalesce(usdt, 0) + v_row.reward_amount, 8),
           total_earned = round(coalesce(total_earned, 0) + v_row.reward_amount, 8),
           updated_at = now()
     where user_id = v_user;
    perform public.wallet_tx(
      v_user, 'promo', v_row.reward_amount,
      'Gift code redeemed: ' || v_row.code,
      'completed', null, null
    );
  else
    v_pts := round(v_row.reward_amount)::bigint;
    update public.balances
       set points = coalesce(points, 0) + v_pts,
           updated_at = now()
     where user_id = v_user;
  end if;

  return jsonb_build_object(
    'redeemed', jsonb_build_object(
      'code',         v_row.code,
      'title',        v_row.title,
      'rewardType',   v_row.reward_type,
      'rewardAmount', v_row.reward_amount
    ),
    'history', (public.promo_history()->'items')
  );
end;
$$;

create or replace function public.admin_promo_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           p.id,
    'code',         p.code,
    'title',        p.title,
    'rewardType',   p.reward_type,
    'rewardAmount', p.reward_amount,
    'maxUses',      p.max_uses,
    'usedCount',    p.used_count,
    'active',       p.active,
    'expiresAt',    case when p.expires_at is null then null else floor(extract(epoch from p.expires_at) * 1000)::bigint end,
    'createdAt',    floor(extract(epoch from p.created_at) * 1000)::bigint
  ) order by p.created_at desc), '[]'::jsonb)
  into v_items
  from public.promo_codes p;

  return jsonb_build_object('codes', v_items);
end;
$$;

create or replace function public.admin_promo_save(
  p_code text,
  p_title text default '',
  p_reward_type text default 'points',
  p_reward_amount numeric default 50,
  p_max_uses integer default 0,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text := upper(regexp_replace(trim(coalesce(p_code, '')), '[^A-Za-z0-9_-]', '', 'g'));
  v_type  text := lower(trim(coalesce(p_reward_type, 'points')));
  v_amt   numeric := coalesce(p_reward_amount, 0);
  v_max   int := greatest(0, coalesce(p_max_uses, 0));
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if length(v_code) < 3 or length(v_code) > 32 then
    raise exception 'Promo code must be 3 to 32 letters, numbers, dashes or underscores.'
      using errcode = 'P0001';
  end if;
  if v_type not in ('points', 'usdt') then
    raise exception 'Reward type must be points or usdt.' using errcode = 'P0001';
  end if;
  if v_amt <= 0 then
    raise exception 'Reward amount must be greater than zero.' using errcode = 'P0001';
  end if;

  if v_type = 'points' then
    v_amt := greatest(1, round(v_amt));
  else
    v_amt := round(v_amt, 4);
  end if;

  insert into public.promo_codes (
    code, title, reward_type, reward_amount, max_uses, active, expires_at, created_by
  ) values (
    v_code, trim(coalesce(p_title, '')), v_type, v_amt, v_max, true, p_expires_at, auth.uid()
  )
  on conflict (code) do update
    set title         = excluded.title,
        reward_type   = excluded.reward_type,
        reward_amount = excluded.reward_amount,
        max_uses      = excluded.max_uses,
        expires_at    = excluded.expires_at,
        active        = true;

  return public.admin_promo_list();
end;
$$;

create or replace function public.admin_promo_toggle(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.promo_codes set active = coalesce(p_active, false) where id = p_id;
  return public.admin_promo_list();
end;
$$;

create or replace function public.admin_promo_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  delete from public.promo_codes where id = p_id;
  return public.admin_promo_list();
end;
$$;

-- -------------------------------------------------------------------------
-- 5. Weekly Leaderboard & Prize Pool
-- -------------------------------------------------------------------------

create or replace function public.leaderboard_rows(
  p_category text,
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  user_id uuid,
  score numeric,
  rank_num bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_category = 'taskers' then
    return query
    with raw_scores as (
      select s.worker as uid, 1::numeric as val
        from public.market_campaign_subs s
       where s.status = 'approved' and s.at >= p_start and s.at < p_end
      union all
      select j.worker as uid, 1::numeric as val
        from public.job_subs j
       where j.status = 'approved' and j.at >= p_start and j.at < p_end
    ),
    agg as (
      select uid, sum(val) as total
        from raw_scores
       where uid is not null
       group by uid
      having sum(val) > 0
    )
    select a.uid, a.total,
           row_number() over (order by a.total desc, a.uid asc)
      from agg a;

  elsif p_category = 'referrers' then
    return query
    with agg as (
      select r.referrer_user as uid, count(*)::numeric as total
        from public.referrals r
       where r.created_at >= p_start and r.created_at < p_end
         and r.referrer_user is not null
       group by r.referrer_user
      having count(*) > 0
    )
    select a.uid, a.total,
           row_number() over (order by a.total desc, a.uid asc)
      from agg a;

  else
    -- 'earners': combined weekly earnings in USD equivalent
    return query
    with raw_scores as (
      select w.user_id as uid, w.amount::numeric as val
        from public.wallet_txns w
       where w.at >= p_start and w.at < p_end
         and w.amount > 0
         and w.status = 'completed'
         and w.type in ('task', 'streak', 'referral', 'mining', 'quest', 'lucky_spin', 'vip_bonus', 'leaderboard')
      union all
      select m.user_id as uid, m.amount::numeric as val
        from public.mining_ledger m
       where m.at >= p_start and m.at < p_end
         and m.type = 'claim' and m.amount > 0
      union all
      select qc.user_id as uid,
             (case when qc.reward_type = 'points' then qc.reward_amount * 0.0001 else 0 end)::numeric as val
        from public.quest_claims qc
       where qc.claimed_at >= p_start and qc.claimed_at < p_end
         and qc.reward_type = 'points'
      union all
      select sl.user_id as uid,
             (case when sl.reward_type = 'points' then sl.reward_amount * 0.0001 else 0 end)::numeric as val
        from public.spin_logs sl
       where sl.spun_at >= p_start and sl.spun_at < p_end
         and sl.reward_type = 'points'
    ),
    agg as (
      select uid, round(sum(val), 4) as total
        from raw_scores
       where uid is not null
       group by uid
      having sum(val) > 0
    )
    select a.uid, a.total,
           row_number() over (order by a.total desc, a.uid asc)
      from agg a;
  end if;
end;
$$;

create or replace function public.leaderboard_state(p_category text default 'earners')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := public.wallet_require_user();
  v_cat        text := case when lower(coalesce(p_category, 'earners')) in ('earners', 'taskers', 'referrers')
                            then lower(p_category) else 'earners' end;
  v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  v_week_end   timestamptz := (date_trunc('week', now() at time zone 'UTC') + interval '7 days') at time zone 'UTC';
  v_week_key   text := to_char(v_week_start at time zone 'UTC', 'IYYY-"W"IW');
  v_prev_start timestamptz := (date_trunc('week', now() at time zone 'UTC') - interval '7 days') at time zone 'UTC';
  v_prev_key   text := to_char(v_prev_start at time zone 'UTC', 'IYYY-"W"IW');
  v_rows       jsonb := '[]'::jsonb;
  v_my_rank    bigint := null;
  v_my_score   numeric := 0;
  v_prizes     jsonb := '[]'::jsonb;
  v_c          text;
  v_pr_rank    bigint;
  v_pr_amt     numeric;
  v_pr_claimed boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'rank',        r.rank_num,
    'displayName', coalesce(nullif(trim(p.display_name), ''), 'FlexFam Member'),
    'profileCode', rc.code,
    'score',       r.score,
    'isMe',        (r.user_id = v_user),
    'vipTier',     (public.vip_profile_calc(r.user_id)->>'tierId'),
    'vipIcon',     (public.vip_profile_calc(r.user_id)->>'tierIcon')
  ) order by r.rank_num asc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.leaderboard_rows(v_cat, v_week_start, v_week_end)
     order by rank_num asc
     limit 20
  ) r
  left join public.profiles p on p.id = r.user_id
  left join public.referral_codes rc on rc.user_id = r.user_id;

  select r.rank_num, r.score
    into v_my_rank, v_my_score
    from public.leaderboard_rows(v_cat, v_week_start, v_week_end) r
   where r.user_id = v_user
   limit 1;

  foreach v_c in array array['earners', 'taskers', 'referrers'] loop
    v_pr_rank := null;
    select r.rank_num into v_pr_rank
      from public.leaderboard_rows(v_c, v_prev_start, v_week_start) r
     where r.user_id = v_user and r.rank_num <= 3
     limit 1;

    if v_pr_rank is not null then
      v_pr_amt := case v_pr_rank when 1 then 0.25 when 2 then 0.10 else 0.05 end;
      select exists(
        select 1 from public.leaderboard_claims
         where user_id = v_user and week_key = v_prev_key and category = v_c
      ) into v_pr_claimed;

      v_prizes := v_prizes || jsonb_build_array(jsonb_build_object(
        'category',     v_c,
        'weekKey',      v_prev_key,
        'rank',         v_pr_rank,
        'rewardType',   'usdt',
        'rewardAmount', v_pr_amt,
        'claimed',      v_pr_claimed
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'category',        v_cat,
    'weekKey',         v_week_key,
    'prevWeekKey',     v_prev_key,
    'weekResetAt',     floor(extract(epoch from v_week_end) * 1000)::bigint,
    'entries',         v_rows,
    'myRank',          v_my_rank,
    'myScore',         coalesce(v_my_score, 0),
    'claimablePrizes', v_prizes,
    'prizePool',       jsonb_build_array(
      jsonb_build_object('rank', 1, 'rewardType', 'usdt', 'rewardAmount', 0.25),
      jsonb_build_object('rank', 2, 'rewardType', 'usdt', 'rewardAmount', 0.10),
      jsonb_build_object('rank', 3, 'rewardType', 'usdt', 'rewardAmount', 0.05)
    )
  );
end;
$$;

create or replace function public.leaderboard_claim(p_category text, p_week_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := public.wallet_require_user();
  v_cat        text := lower(trim(coalesce(p_category, '')));
  v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  v_prev_start timestamptz := (date_trunc('week', now() at time zone 'UTC') - interval '7 days') at time zone 'UTC';
  v_prev_key   text := to_char(v_prev_start at time zone 'UTC', 'IYYY-"W"IW');
  v_rank       bigint;
  v_amt        numeric;
begin
  if v_cat not in ('earners', 'taskers', 'referrers') then
    raise exception 'Invalid leaderboard category.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_week_key), '') <> v_prev_key then
    raise exception 'Only the previous completed week (%) can be claimed.', v_prev_key
      using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_user)
  on conflict (user_id) do nothing;
  perform 1 from public.balances where user_id = v_user for update;

  if exists (
    select 1 from public.leaderboard_claims
     where user_id = v_user and week_key = v_prev_key and category = v_cat
  ) then
    raise exception 'You already claimed your % leaderboard prize for %.', v_cat, v_prev_key
      using errcode = 'P0001';
  end if;

  select r.rank_num into v_rank
    from public.leaderboard_rows(v_cat, v_prev_start, v_week_start) r
   where r.user_id = v_user and r.rank_num <= 3
   limit 1;

  if v_rank is null then
    raise exception 'You did not finish in the Top 3 for % during %.', v_cat, v_prev_key
      using errcode = 'P0001';
  end if;

  v_amt := case v_rank when 1 then 0.25 when 2 then 0.10 else 0.05 end;

  insert into public.leaderboard_claims (user_id, week_key, category, rank, reward_type, reward_amount)
  values (v_user, v_prev_key, v_cat, v_rank::int, 'usdt', v_amt);

  update public.balances
     set usdt = round(coalesce(usdt, 0) + v_amt, 8),
         total_earned = round(coalesce(total_earned, 0) + v_amt, 8),
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(
    v_user, 'leaderboard', v_amt,
    'Weekly Leaderboard #' || v_rank || ' prize (' || v_cat || ' · ' || v_prev_key || ')',
    'completed', null, null
  );

  return jsonb_build_object(
    'claimed', jsonb_build_object(
      'category',     v_cat,
      'weekKey',      v_prev_key,
      'rank',         v_rank,
      'rewardType',   'usdt',
      'rewardAmount', v_amt
    ),
    'state', public.leaderboard_state(v_cat)
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 6. Public Member Profile & Showcase Card (anon + authenticated safe)
-- -------------------------------------------------------------------------

create or replace function public.public_profile_card(p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_uid     uuid := null;
  v_name    text := 'FlexFam Member';
  v_joined  timestamptz := now();
  v_vip     jsonb;
  v_bd      jsonb;
  v_tasks   bigint;
  v_streak  bigint;
  v_refs    bigint;
  v_created bigint;
  v_badges  text[] := array[]::text[];
  v_rank    text := 'Newcomer';
begin
  if v_code <> '' then
    select rc.user_id, rc.code
      into v_uid, v_code
      from public.referral_codes rc
     where upper(rc.code) = v_code
     limit 1;
  elsif auth.uid() is not null then
    v_uid := auth.uid();
    select rc.code into v_code
      from public.referral_codes rc
     where rc.user_id = v_uid
     limit 1;
    if v_code is null then
      v_code := 'FF-' || upper(substr(replace(v_uid::text, '-', ''), 1, 8));
      insert into public.referral_codes (user_id, code)
      values (v_uid, v_code)
      on conflict (user_id) do nothing;
      select rc.code into v_code
        from public.referral_codes rc
       where rc.user_id = v_uid
       limit 1;
    end if;
  end if;

  if v_uid is null then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(nullif(trim(p.display_name), ''), 'FlexFam Member'),
         coalesce(p.created_at, now())
    into v_name, v_joined
    from public.profiles p
   where p.id = v_uid;

  v_vip := public.vip_profile_calc(v_uid);
  v_bd := v_vip->'breakdown';
  v_tasks := coalesce((v_bd->>'totalTasks')::bigint, 0);
  v_streak := coalesce((v_bd->>'bestStreak')::bigint, 0);
  v_refs := coalesce((v_bd->>'referrals')::bigint, 0);
  v_created := coalesce((v_bd->>'createdCount')::bigint, 0);

  if v_tasks >= 5   then v_badges := array_append(v_badges, 'badge_starter'); end if;
  if v_tasks >= 25  then v_badges := array_append(v_badges, 'badge_hunter'); end if;
  if v_tasks >= 100 then v_badges := array_append(v_badges, 'badge_legend'); end if;
  if v_streak >= 7  then v_badges := array_append(v_badges, 'badge_streak7'); end if;
  if v_streak >= 30 then v_badges := array_append(v_badges, 'badge_streak30'); end if;
  if v_refs >= 3    then v_badges := array_append(v_badges, 'badge_builder'); end if;
  if v_refs >= 1000 then v_badges := array_append(v_badges, 'badge_ambassador'); end if;
  if v_created >= 1 then v_badges := array_append(v_badges, 'badge_creator'); end if;

  v_rank := case
    when coalesce(array_length(v_badges, 1), 0) >= 8 then 'FlexFam Legend'
    when coalesce(array_length(v_badges, 1), 0) >= 5 then 'Elite Earner'
    when coalesce(array_length(v_badges, 1), 0) >= 3 then 'Task Specialist'
    when coalesce(array_length(v_badges, 1), 0) >= 1 then 'Rising Earner'
    else 'Newcomer'
  end;

  return jsonb_build_object(
    'found',       true,
    'isOwn',       (auth.uid() is not null and auth.uid() = v_uid),
    'displayName', v_name,
    'code',        v_code,
    'joinedAt',    floor(extract(epoch from v_joined) * 1000)::bigint,
    'masteryRank', v_rank,
    'vip',         v_vip,
    'badges',      to_jsonb(v_badges),
    'stats', jsonb_build_object(
      'totalTasks',     v_tasks,
      'currentStreak',  coalesce((v_bd->>'currentStreak')::bigint, 0),
      'bestStreak',     v_streak,
      'referrals',      v_refs,
      'createdCount',   v_created,
      'badgesUnlocked', coalesce(array_length(v_badges, 1), 0),
      'badgesTotal',    8
    )
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 7. Permissions & PostgREST Reload
-- -------------------------------------------------------------------------

revoke all on function public.vip_profile_calc(uuid) from public, anon, authenticated;
revoke all on function public.leaderboard_rows(text, timestamptz, timestamptz) from public, anon, authenticated;

revoke all on function public.vip_state() from public, anon;
grant execute on function public.vip_state() to authenticated;

revoke all on function public.vip_claim_daily() from public, anon;
grant execute on function public.vip_claim_daily() to authenticated;

revoke all on function public.spin_state() from public, anon;
grant execute on function public.spin_state() to authenticated;

revoke all on function public.spin_play(boolean) from public, anon;
grant execute on function public.spin_play(boolean) to authenticated;

revoke all on function public.promo_history() from public, anon;
grant execute on function public.promo_history() to authenticated;

revoke all on function public.promo_redeem(text) from public, anon;
grant execute on function public.promo_redeem(text) to authenticated;

revoke all on function public.admin_promo_list() from public, anon;
grant execute on function public.admin_promo_list() to authenticated;

revoke all on function public.admin_promo_save(text, text, text, numeric, integer, timestamptz) from public, anon;
grant execute on function public.admin_promo_save(text, text, text, numeric, integer, timestamptz) to authenticated;

revoke all on function public.admin_promo_toggle(uuid, boolean) from public, anon;
grant execute on function public.admin_promo_toggle(uuid, boolean) to authenticated;

revoke all on function public.admin_promo_delete(uuid) from public, anon;
grant execute on function public.admin_promo_delete(uuid) to authenticated;

revoke all on function public.leaderboard_state(text) from public, anon;
grant execute on function public.leaderboard_state(text) to authenticated;

revoke all on function public.leaderboard_claim(text, text) from public, anon;
grant execute on function public.leaderboard_claim(text, text) to authenticated;

-- Public showcase card is intentionally readable without login (exposes ONLY non-sensitive stats)
revoke all on function public.public_profile_card(text) from public;
grant execute on function public.public_profile_card(text) to anon, authenticated;

notify pgrst, 'reload schema';
