-- ============================================================
-- FlexFam · DAILY STREAK (roz claim karo → USDT pao)
--
--   • Har din (IST) ek claim — reward streak ke saath badhta hai
--   • Day 1..6: $0.01, 0.02, 0.03, 0.05, 0.08, 0.12
--     Day 7 aur uske baad har din: $0.20
--   • Din miss → streak reset Day 1
--   • Reward seedha wallet (USDT balance) me + wallet history me log
--
-- Dashboard par "Daily streak 🔥" panel + claim par coin sound.
-- Safe to re-run. RUN ORDER: supabase-wallet.sql ke baad
-- (balances + wallet_tx chahiye).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table — har member ki streak state
-- ------------------------------------------------------------
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
-- 2. streak_state() — panel ka data (claim karne se pehle)
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
    'rewards',      public.streak_reward_list(),
    'today',        to_char(v_today, 'YYYY-MM-DD')
  );
end;
$$;

-- reward list (UI chips ke liye) — Day 1..7
create or replace function public.streak_reward_list()
returns jsonb language sql immutable as $$
  select '[0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.20]'::jsonb;
$$;

-- ek din ka reward — Day 7+ = $0.20
create or replace function public.streak_reward(p_day int)
returns numeric language sql immutable as $$
  select case when coalesce(p_day, 1) >= 7 then 0.20
              else (array[0.01, 0.02, 0.03, 0.05, 0.08, 0.12])[greatest(1, least(6, coalesce(p_day, 1)))]
         end;
$$;

-- ------------------------------------------------------------
-- 3. streak_claim() — din ka reward claim karo (USDT credit)
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
    'Day ' || v_streak || ' daily streak reward', 'completed', null, null);

  return jsonb_build_object(
    'ok', true, 'reward', v_reward, 'day', v_streak,
    'canClaim', false, 'claimedToday', true,
    'streak', v_streak, 'best', v_best,
    'claims', coalesce(s.claims, 0) + 1,
    'nextDay', v_streak, 'nextReward', public.streak_reward(v_streak),
    'rewards', public.streak_reward_list()
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. Permissions
-- ------------------------------------------------------------
revoke all on function public.streak_state()                 from public, anon;
revoke all on function public.streak_claim()                 from public, anon;
revoke all on function public.streak_reward(int)             from public, anon;
revoke all on function public.streak_reward_list()           from public, anon;

grant execute on function public.streak_state()              to authenticated;
grant execute on function public.streak_claim()              to authenticated;
