-- ============================================================
-- FlexFam · DAILY STREAK v2 — 90-DAY (TimeBucks style)
--
--   • Roz ek claim (IST) — reward 90 din tak badhta rehta hai
--   • 9 ranks: Rookie → Hustler → Earner → Grinder → Veteran
--     → Expert → Master → Grandmaster → Legend → Godlike
--   • Day 91+ har din $5.50 (streak zinda rahe toh)
--   • Din miss → streak reset Day 1 ($0.001)
--   • Reward seedha wallet (USDT) me + wallet history log
--
-- Safe to re-run. RUN ORDER: supabase-wallet.sql ke baad.
-- ============================================================

-- 1. Table — har member ki streak state
create table if not exists public.daily_streaks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  streak     int  not null default 0,
  best       int  not null default 0,
  claims     int  not null default 0,
  last_date  date,
  updated_at timestamptz not null default now()
);

alter table public.daily_streaks enable row level security;
-- koi direct policy nahi — sirf niche wale security-definer RPCs se access

-- ------------------------------------------------------------
-- 2. Reward ladder — Day 1..90 (exact TimeBucks values) + Day 91+ $5.50
-- ------------------------------------------------------------
create or replace function public.streak_reward(p_day int)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_day, 1) >= 91 then 5.50
    else (array[
      0.001,0.002,0.003,0.004,0.006,0.007,0.008,0.009,0.010,0.011,  -- Rookie   1-10
      0.012,0.013,0.014,0.015,0.017,0.018,0.019,0.021,0.022,0.024,  -- Hustler  11-20
      0.026,0.028,0.030,0.033,0.035,0.039,0.041,0.044,0.048,0.052,  -- Earner   21-30
      0.056,0.061,0.066,0.072,0.077,0.083,0.089,0.097,0.100,0.110,  -- Grinder  31-40
      0.12,0.13,0.14,0.15,0.16,0.18,0.19,0.21,0.22,0.24,            -- Veteran  41-50
      0.26,0.28,0.31,0.33,0.36,0.39,0.42,0.45,0.49,0.53,            -- Expert   51-60
      0.57,0.62,0.67,0.73,0.78,0.85,0.92,0.99,1.07,1.16,            -- Master   61-70
      1.25,1.36,1.47,1.58,1.71,1.85,2.00,2.16,2.34,2.53,            -- Grandmaster 71-80
      2.73,2.95,3.19,3.45,3.73,4.03,4.36,4.71,5.09,5.50             -- Legend   81-90
    ])[least(greatest(coalesce(p_day, 1), 1), 90)]
  end;
$$;

-- UI chips ke liye poora ladder
create or replace function public.streak_reward_list()
returns jsonb language sql immutable as $$
  select '[
    0.001,0.002,0.003,0.004,0.006,0.007,0.008,0.009,0.010,0.011,
    0.012,0.013,0.014,0.015,0.017,0.018,0.019,0.021,0.022,0.024,
    0.026,0.028,0.030,0.033,0.035,0.039,0.041,0.044,0.048,0.052,
    0.056,0.061,0.066,0.072,0.077,0.083,0.089,0.097,0.100,0.110,
    0.12,0.13,0.14,0.15,0.16,0.18,0.19,0.21,0.22,0.24,
    0.26,0.28,0.31,0.33,0.36,0.39,0.42,0.45,0.49,0.53,
    0.57,0.62,0.67,0.73,0.78,0.85,0.92,0.99,1.07,1.16,
    1.25,1.36,1.47,1.58,1.71,1.85,2.00,2.16,2.34,2.53,
    2.73,2.95,3.19,3.45,3.73,4.03,4.36,4.71,5.09,5.50
  ]'::jsonb;
$$;

-- rank ka naam
create or replace function public.streak_rank(p_day int)
returns text language sql immutable as $$
  select case
    when coalesce(p_day, 1) >= 91 then 'Godlike'
    when p_day >= 81 then 'Legend'
    when p_day >= 71 then 'Grandmaster'
    when p_day >= 61 then 'Master'
    when p_day >= 51 then 'Expert'
    when p_day >= 41 then 'Veteran'
    when p_day >= 31 then 'Grinder'
    when p_day >= 21 then 'Earner'
    when p_day >= 11 then 'Hustler'
    else 'Rookie'
  end;
$$;

-- ------------------------------------------------------------
-- 3. streak_state() — panel ka data
-- ------------------------------------------------------------
create or replace function public.streak_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := public.wallet_require_user();
  s       public.daily_streaks;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_can   boolean;
  v_next  int;
begin
  select * into s from public.daily_streaks where user_id = v_user;

  v_can := (s.user_id is null) or (s.last_date is null) or (s.last_date < v_today);
  if v_can then
    if s.user_id is not null and s.last_date = v_today - 1 then
      v_next := coalesce(s.streak, 0) + 1;
    else
      v_next := 1;  -- naya streak (miss / pehli baar)
    end if;
  else
    v_next := coalesce(s.streak, 0);
  end if;

  return jsonb_build_object(
    'canClaim',     v_can,
    'claimedToday', (s.user_id is not null and s.last_date = v_today),
    'streak',       coalesce(s.streak, 0),
    'best',         coalesce(s.best, 0),
    'claims',       coalesce(s.claims, 0),
    'nextDay',      v_next,
    'nextReward',   public.streak_reward(v_next),
    'nextRank',     public.streak_rank(v_next),
    'rank',         public.streak_rank(greatest(coalesce(s.streak, 1), 1)),
    'rewards',      public.streak_reward_list(),
    'today',        to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. streak_claim() — din ka reward claim karo (USDT credit)
-- ------------------------------------------------------------
create or replace function public.streak_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := public.wallet_require_user();
  s         public.daily_streaks;
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_streak  int;
  v_reward  numeric;
  v_best    int;
begin
  insert into public.daily_streaks (user_id) values (v_user)
  on conflict (user_id) do nothing;

  select * into s from public.daily_streaks where user_id = v_user for update;

  if s.last_date = v_today then
    raise exception 'Already claimed today — come back tomorrow!'
      using errcode = 'P0001';
  end if;

  if s.last_date = v_today - 1 then
    v_streak := coalesce(s.streak, 0) + 1;   -- streak jari hai
  else
    v_streak := 1;                            -- miss hua / pehla claim
  end if;

  v_reward := public.streak_reward(v_streak);
  v_best   := greatest(coalesce(s.best, 0), v_streak);

  update public.daily_streaks
     set streak = v_streak, best = v_best, claims = coalesce(s.claims, 0) + 1,
         last_date = v_today, updated_at = now()
   where user_id = v_user;

  /* USDT seedha wallet me (points nahi) */
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.balances
     set usdt = round(usdt + v_reward, 8),
         total_earned = round(total_earned + v_reward, 8),
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(v_user, 'streak', v_reward,
    'Day ' || v_streak || ' daily streak reward — ' || public.streak_rank(v_streak),
    'completed', null, null);

  return jsonb_build_object(
    'ok', true, 'reward', v_reward, 'day', v_streak,
    'canClaim', false, 'claimedToday', true,
    'streak', v_streak, 'best', v_best,
    'claims', coalesce(s.claims, 0) + 1,
    'nextDay', v_streak, 'nextReward', public.streak_reward(v_streak),
    'nextRank', public.streak_rank(v_streak),
    'rank', public.streak_rank(v_streak),
    'rewards', public.streak_reward_list()
  );
end;
$$;

-- ------------------------------------------------------------
-- 5. Permissions
-- ------------------------------------------------------------
revoke all on function public.streak_state()                 from public, anon;
revoke all on function public.streak_claim()                 from public, anon;
revoke all on function public.streak_reward(int)             from public, anon;
revoke all on function public.streak_reward_list()           from public, anon;
revoke all on function public.streak_rank(int)               from public, anon;

grant execute on function public.streak_state()              to authenticated;
grant execute on function public.streak_claim()              to authenticated;
