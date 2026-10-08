-- ============================================================
-- FlexFam · DAILY STREAK v3 — 90-DAY (TimeBucks style + earn rule)
--
--   • Roz ek claim (IST) — reward 90 din tak badhta rehta hai
--   • 9 ranks: Rookie → Hustler → Earner → Grinder → Veteran
--     → Expert → Master → Grandmaster → Legend → Godlike
--   • Day 91+ har din $5.50 (streak zinda rahe toh)
--   • Din miss → streak reset Day 1 ($0.001)
--   • Day 1-10 FREE (koi earning condition nahi)
--   • Day 11+ TimeBucks rule: last 48h me minimum earning chahiye
--     (tasks + mining claims + campaigns + referrals; streak/deposit/
--      convert/escrow/refund count NAHI hote). Requirement rank ke
--      saath badhta hai: $0.02 → $5.00 (streak_earn_req ladder).
--   • UI me condition box Day 10 complete hone ke BAAD hi dikhta hai
--     (earnApplies flag) — naye users ko pehle 10 din kuch nahi dikhta.
--   • Reward seedha wallet (USDT) me + wallet history log
--
-- Safe to re-run. RUN ORDER: supabase-wallet.sql ke baad.
-- NOTE: supabase-referral-pyramid.sql streak_claim() ko dobara banata
-- hai — is file ke baad use BHI dobara run karo (earn rule wali copy).
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

-- Earn rule ko referral ka currency column chahiye hota hai. Referral file
-- (#16) ise waise bhi banati hai, par streak (#14) usse pehle chalta hai —
-- isliye yahan bhi ensure karo (idempotent, data safe).
alter table public.wallet_txns add column if not exists ref_level   int;
alter table public.wallet_txns add column if not exists ref_currency text;

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
-- 2b. Earn-requirement ladder (TimeBucks rule) — Day 11+ ke liye
--     last 48h me kitna USDT-equivalent kamaya hona chahiye.
--     Shuru easy ($0.02), aage challenging ($5.00) — sirf active
--     members Day 90 / Godlike tak pahunchenge.
-- ------------------------------------------------------------
create or replace function public.streak_earn_req(p_day int)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_day, 1) <= 10 then 0      -- Rookie: free
    when p_day <= 20 then 0.02                -- Hustler: 1 micro-task
    when p_day <= 30 then 0.05                -- Earner: ~1 din free mining
    when p_day <= 40 then 0.10                -- Grinder
    when p_day <= 50 then 0.20                -- Veteran
    when p_day <= 60 then 0.40                -- Expert
    when p_day <= 70 then 0.80                -- Master
    when p_day <= 80 then 1.50                -- Grandmaster
    when p_day <= 90 then 3.00                -- Legend
    else 5.00                                 -- Godlike: power users only
  end;
$$;

-- ------------------------------------------------------------
-- 2c. Last 48h me USDT-equivalent earning (TimeBucks "since your
--     last check-in" rule ka FlexFam version).
--     COUNTS: tasks (earning) + mining claims + campaigns (points
--     ko points_per_usdt se USDT me badal ke) + referrals (USDT +
--     points-dono). EXCLUDES: streak khud, deposit, convert,
--     escrow, payout, refund — taaki condition ko khareeda ya
--     ghumaya (cycle) na ja sake.
-- ------------------------------------------------------------
create or replace function public.streak_earned_48h(p_user uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_rate int := 1000;
  v_usdt numeric := 0;
  v_mine numeric := 0;
  v_pts  numeric := 0;
  v_tmp  numeric := 0;
begin
  if p_user is null then return 0; end if;
  select points_per_usdt into v_rate from public.mining_config where id = 1;
  if v_rate is null or v_rate <= 0 then v_rate := 1000; end if;

  -- 1) tasks + USDT referrals (completed, positive only)
  select coalesce(sum(amount), 0) into v_usdt
    from public.wallet_txns
   where user_id = p_user
     and at >= now() - interval '48 hours'
     and status = 'completed' and amount > 0
     and (type = 'earning'
          or (type = 'referral' and coalesce(ref_currency, 'usdt') = 'usdt'));

  -- 2) mining claims — USDT mode ho ya points mode, ledger.amount
  --    hamesha USDT value hoti hai, isliye seedha judti hai.
  select coalesce(sum(amount), 0) into v_mine
    from public.mining_ledger
   where user_id = p_user
     and at >= now() - interval '48 hours'
     and type = 'claim' and amount > 0;

  -- 3) campaigns: last 48h me approved payouts (points).
  --    Campaigns migration (#5) optional hai — table na ho to skip.
  --    (Dynamic SQL taaki table missing ho tab bhi function bane.)
  if to_regclass('public.market_campaign_subs') is not null
     and to_regclass('public.market_campaigns') is not null then
    execute $$
      select coalesce(sum(c.payout), 0)
        from public.market_campaign_subs s
        join public.market_campaigns c on c.id = s.campaign_id
       where s.worker = $1 and s.status = 'approved'
         and coalesce(s.reviewed_at, s.at) >= now() - interval '48 hours'
    $$ using p_user into v_tmp;
    v_pts := v_pts + coalesce(v_tmp, 0);
  end if;

  -- 4) referral points (USDT referrals upar #1 me aa gaye)
  select coalesce(sum(amount), 0) into v_tmp
    from public.wallet_txns
   where user_id = p_user
     and at >= now() - interval '48 hours'
     and status = 'completed' and amount > 0
     and type = 'referral' and ref_currency = 'points';
  v_pts := v_pts + coalesce(v_tmp, 0);

  return round(coalesce(v_usdt, 0) + coalesce(v_mine, 0)
               + coalesce(v_pts, 0) / v_rate, 8);
end;
$$;

-- ------------------------------------------------------------
-- 3. streak_state() — panel ka data (+ earn-rule fields)
-- ------------------------------------------------------------
create or replace function public.streak_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := public.wallet_require_user();
  s       public.daily_streaks;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_can   boolean;
  v_next  int;
  v_streak int;
  v_earn_day int;
  v_earn_req numeric;
  v_earned   numeric := 0;
  v_applies  boolean;
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

  v_streak := coalesce(s.streak, 0);

  -- Earn rule wala day: claim pending hai to AAJ ka v_next, warna
  -- KAL ka (streak+1) preview — taaki Day 10 claim karte hi Day 11
  -- ki condition dikhne lage ("jab lagne wali ho tab hi pata chale").
  if v_can then v_earn_day := v_next;
  else v_earn_day := v_streak + 1;
  end if;
  v_earn_req := public.streak_earn_req(v_earn_day);
  v_applies  := (v_earn_req > 0);
  if v_applies then
    v_earned := public.streak_earned_48h(v_user);
  end if;

  return jsonb_build_object(
    'canClaim',     v_can,
    'claimedToday', (s.user_id is not null and s.last_date = v_today),
    'streak',       v_streak,
    'best',         coalesce(s.best, 0),
    'claims',       coalesce(s.claims, 0),
    'nextDay',      v_next,
    'nextReward',   public.streak_reward(v_next),
    'nextRank',     public.streak_rank(v_next),
    'rank',         public.streak_rank(greatest(v_streak, 1)),
    'rewards',      public.streak_reward_list(),
    'today',        to_char(v_today, 'YYYY-MM-DD'),
    'earnApplies',  v_applies,
    'earnForDay',   v_earn_day,
    'earnRequired', v_earn_req,
    'earnDone',     coalesce(v_earned, 0),
    'earnNeed',     greatest(v_earn_req - coalesce(v_earned, 0), 0),
    'earnMet',      (coalesce(v_earned, 0) >= v_earn_req),
    'earnWindowHrs', 48
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. streak_claim() — din ka reward claim karo (USDT credit)
--    Day 11+ par earn rule enforce hota hai (TimeBucks jaisa).
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
  v_req     numeric;
  v_earned  numeric := 0;
  v_tom_req numeric;
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

  -- TimeBucks earn rule: Day 11+ ke liye last 48h ki earning check.
  -- (Day 1-10 free — v_req = 0, koi block nahi.)
  v_req := public.streak_earn_req(v_streak);
  if v_req > 0 then
    v_earned := public.streak_earned_48h(v_user);
    if v_earned < v_req then
      raise exception 'Day % is locked — earn $% in the last 48 hours (tasks, campaigns, mining) to unlock it. You have $% — earn $% more, then check in.',
        v_streak, round(v_req, 2), round(v_earned, 4), round(v_req - v_earned, 4)
        using errcode = 'P0001';
    end if;
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

  -- Kal ka preview (Day 10 claim ke baad Day 11 ki condition dikhe).
  -- Streak reward khud earn-count me nahi judta, isliye v_earned kal
  -- ke liye bhi same hai; Day 1-10 wale claims par fresh compute karo.
  v_tom_req := public.streak_earn_req(v_streak + 1);
  if v_tom_req > 0 and v_req <= 0 then
    v_earned := public.streak_earned_48h(v_user);
  end if;

  return jsonb_build_object(
    'ok', true, 'reward', v_reward, 'day', v_streak,
    'canClaim', false, 'claimedToday', true,
    'streak', v_streak, 'best', v_best,
    'claims', coalesce(s.claims, 0) + 1,
    'nextDay', v_streak, 'nextReward', public.streak_reward(v_streak),
    'nextRank', public.streak_rank(v_streak),
    'rank', public.streak_rank(v_streak),
    'rewards', public.streak_reward_list(),
    'earnApplies', (v_tom_req > 0),
    'earnForDay', v_streak + 1,
    'earnRequired', v_tom_req,
    'earnDone', case when v_tom_req > 0 then coalesce(v_earned, 0) else 0 end,
    'earnNeed', greatest(v_tom_req - coalesce(v_earned, 0), 0),
    'earnMet', (coalesce(v_earned, 0) >= v_tom_req),
    'earnWindowHrs', 48
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
revoke all on function public.streak_earn_req(int)           from public, anon, authenticated;
revoke all on function public.streak_earned_48h(uuid)        from public, anon, authenticated;

grant execute on function public.streak_state()              to authenticated;
grant execute on function public.streak_claim()              to authenticated;
