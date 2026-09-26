-- ============================================================
-- FlexFam · REFERRAL PYRAMID — 3-level referral income
--
--   Level 1 (direct invites)        → 10% of their earnings
--   Level 2 (invites of your L1)    →  3%
--   Level 3 (invites of your L2)    →  1%
--
--   • Earnings = campaign rewards (points), task approvals (USDT),
--     daily streak (USDT) aur mining claims (USDT ya points)
--   • Commission usi currency me milti hai jisme member ne kamaya
--   • Har commission wallet history me "L1/L2/L3 referral income"
--     entry ke saath dikhti hai
--   • Cycle-safe (referrals table me 1 row per member) aur
--     commission par commission NAHI lagti (sirf real earnings par)
--
-- SAFE TO RE-RUN. RUN ORDER: sab existing files ke BAAD (sabse
-- aakhir) — ye 4 earn functions ko latest bodies ke saath re-create
-- karta hai (campaigns_submit_proof, wallet_settle_sub, streak_claim,
-- mining_claim) + referral_payout call add karta hai.
-- ============================================================

-- ------------------------------------------------------------
-- 0. wallet_txns me level/currency columns (commission tracking)
-- ------------------------------------------------------------
alter table public.wallet_txns add column if not exists ref_level   int;
alter table public.wallet_txns add column if not exists ref_currency text;

-- ------------------------------------------------------------
-- 1. referral_payout — internal helper (browser se direct call nahi)
--    p_user ne jitna kamaya, uske 3 uplines ko 10/3/1% do
-- ------------------------------------------------------------
create or replace function public.referral_payout(
  p_user uuid, p_amount numeric, p_currency text, p_note text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rates numeric[] := array[0.10, 0.03, 0.01];  -- L1, L2, L3
  v_from  uuid := p_user;
  v_up    uuid;
  v_amt   numeric;
  v_lvl   int := 1;
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  if p_currency not in ('points', 'usdt') then return; end if;

  while v_lvl <= 3 loop
    select referrer_user into v_up from public.referrals
     where referred_user = v_from;
    exit when v_up is null or v_up = p_user;

    if p_currency = 'points' then
      v_amt := floor(p_amount * v_rates[v_lvl]);
    else
      v_amt := round(p_amount * v_rates[v_lvl], 8);
    end if;

    if v_amt > 0 then
      insert into public.balances (user_id) values (v_up)
      on conflict (user_id) do nothing;

      if p_currency = 'points' then
        update public.balances
           set points = points + v_amt, updated_at = now()
         where user_id = v_up;
      else
        update public.balances
           set usdt = round(usdt + v_amt, 8),
               total_earned = round(total_earned + v_amt, 8),
               updated_at = now()
         where user_id = v_up;
      end if;

      insert into public.wallet_txns
        (user_id, type, amount, note, status, ref_id, ref_level, ref_currency)
      values
        (v_up, 'referral', v_amt,
         'L' || v_lvl || ' referral income · ' || coalesce(p_note, ''),
         'completed', p_user, v_lvl, p_currency);
    end if;

    v_from := v_up;
    v_lvl := v_lvl + 1;
  end loop;
end;
$$;

revoke all on function public.referral_payout(uuid, numeric, text, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. campaigns_submit_proof — LIMIT version + referral payout
--    (latest live body: auto-approve + engagement limit guard)
-- ------------------------------------------------------------
create or replace function public.campaigns_submit_proof(p_campaign text, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  c public.market_campaigns;
  s public.market_campaign_subs;
  bal public.balances;
  v_resubmit boolean := false;
begin
  select * into c from public.market_campaigns where id = p_campaign for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  if c.owner = v_user then raise exception 'You cannot complete your own campaign' using errcode = 'P0001'; end if;
  if c.active = false then raise exception 'This campaign is paused' using errcode = 'P0001'; end if;
  if c.max_actions > 0 and c.actions >= c.max_actions then
    raise exception 'This campaign reached its engagement limit' using errcode = 'P0001';
  end if;
  if p_proof is null or length(trim(p_proof)) < 3 then
    raise exception 'Add proof (link, username or screenshot URL)' using errcode = 'P0001';
  end if;

  select * into s from public.market_campaign_subs
   where campaign_id = p_campaign and worker = v_user;
  if found then
    if s.status <> 'rejected' then
      raise exception 'You already submitted this campaign' using errcode = 'P0001';
    end if;
    v_resubmit := true;
  end if;

  insert into public.balances (user_id) values (c.owner) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = c.owner for update;
  if bal.points < c.payout then
    raise exception 'This campaign cannot pay out right now — please try again later.'
      using errcode = 'P0001';
  end if;

  if v_resubmit then
    update public.market_campaign_subs
       set proof = trim(p_proof), note = coalesce(trim(p_note), ''),
           status = 'approved', reason = '', at = now(), reviewed_at = now()
     where id = s.id;
  else
    insert into public.market_campaign_subs (campaign_id, worker, proof, note, status, reviewed_at)
    values (p_campaign, v_user, trim(p_proof), coalesce(trim(p_note), ''), 'approved', now());
  end if;

  update public.balances
     set points = points - c.payout, updated_at = now()
   where user_id = c.owner;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.balances
     set points = points + c.payout, updated_at = now()
   where user_id = v_user;

  update public.market_campaigns
     set actions = actions + 1, spent = round(spent + c.payout, 2)
   where id = c.id;

  /* PYRAMID: worker ke 3 uplines ko 10/3/1% points */
  perform public.referral_payout(v_user, c.payout, 'points',
    'Campaign "' || left(c.title, 40) || '" by ' || public.wallet_display_name(c.owner));

  return public.campaigns_feed();
end;
$$;

revoke all on function public.campaigns_submit_proof(text, text, text) from public, anon;
grant execute on function public.campaigns_submit_proof(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 3. wallet_settle_sub — task approve par uplines ko USDT %
-- ------------------------------------------------------------
create or replace function public.wallet_settle_sub(p_sub uuid, p_approve boolean, p_reason text, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  s public.job_subs;
  j public.jobs;
begin
  select * into s from public.job_subs where id = p_sub for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0001'; end if;
  if not p_admin and s.owner <> v_user then
    raise exception 'Only the task owner can review this proof' using errcode = 'P0001';
  end if;
  if s.status <> 'pending' then raise exception 'Already reviewed' using errcode = 'P0001'; end if;

  select * into j from public.jobs where id = s.job_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;

  update public.job_subs
     set status = case when p_approve then 'approved' else 'rejected' end,
         reason = coalesce(p_reason, ''), reviewed_at = now()
   where id = p_sub;

  if p_approve then
    if j.escrow < j.reward then
      raise exception 'Escrow for this task is exhausted' using errcode = 'P0001';
    end if;

    -- release from the owner's locked escrow into the worker's balance
    update public.balances
       set locked = round(locked - j.reward, 8), updated_at = now()
     where user_id = j.owner;

    insert into public.balances (user_id) values (s.worker) on conflict (user_id) do nothing;
    update public.balances
       set usdt = round(usdt + j.reward, 8),
           total_earned = round(total_earned + j.reward, 8), updated_at = now()
     where user_id = s.worker;

    update public.jobs
       set filled = filled + 1,
           escrow = round(escrow - j.reward, 8),
           status = case when filled + 1 >= slots then 'completed' else status end
     where id = j.id;

    perform public.wallet_tx(j.owner, 'payout', -j.reward,
      'Paid ' || public.wallet_display_name(s.worker) || ' for "' || j.title || '"', 'completed', null, j.id);
    perform public.wallet_tx(s.worker, 'earning', j.reward,
      'Task approved: "' || j.title || '"', 'completed', null, j.id);

    /* PYRAMID: worker ke 3 uplines ko 10/3/1% USDT */
    perform public.referral_payout(s.worker, j.reward, 'usdt',
      'Task "' || left(j.title, 40) || '" approved');
  end if;

  return;
end;
$$;

revoke all on function public.wallet_settle_sub(uuid, boolean, text, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. streak_claim — daily streak reward par uplines ko USDT %
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

  /* PYRAMID: claimer ke 3 uplines ko 10/3/1% USDT */
  perform public.referral_payout(v_user, v_reward, 'usdt',
    'Day ' || v_streak || ' streak of ' || public.wallet_display_name(v_user));

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

revoke all on function public.streak_claim() from public, anon;
grant execute on function public.streak_claim() to authenticated;

-- ------------------------------------------------------------
-- 5. mining_claim — mined USDT/points par uplines ko %
-- ------------------------------------------------------------
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
    /* PYRAMID: points claim par uplines ko 10/3/1% points */
    perform public.referral_payout(v_user, v_points, 'points', 'Mining claim as points');
  else
    update public.balances set usdt = round(usdt + v_amount, 8), updated_at = now() where user_id = v_user;
    perform public.mining_log(v_user, 'claim',
      'Claimed $' || round(v_amount, 4) || ' to the USDT balance', v_amount);
    /* PYRAMID: USDT claim par uplines ko 10/3/1% USDT */
    perform public.referral_payout(v_user, v_amount, 'usdt', 'Mining claim to USDT');
  end if;

  return public.mining_state();
end;
$$;

revoke all on function public.mining_claim(text) from public, anon;
grant execute on function public.mining_claim(text) to authenticated;

-- ------------------------------------------------------------
-- 6. referral_pyramid() — Refer page ka data
-- ------------------------------------------------------------
create or replace function public.referral_pyramid()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;

  return (
    with l1 as (
      select referred_user, created_at from public.referrals where referrer_user = v_user
    ), l2 as (
      select r.referred_user, r.created_at
        from public.referrals r join l1 on r.referrer_user = l1.referred_user
    ), l3 as (
      select r.referred_user, r.created_at
        from public.referrals r join l2 on r.referrer_user = l2.referred_user
    )
    select jsonb_build_object(
      'rates', jsonb_build_object('l1', 0.10, 'l2', 0.03, 'l3', 0.01),
      'levels', jsonb_build_array(
        jsonb_build_object(
          'level', 1,
          'count', (select count(*) from l1),
          'usdt',  (select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 1 and ref_currency = 'usdt'),
          'points',(select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 1 and ref_currency = 'points'),
          'recent',(select coalesce(jsonb_agg(jsonb_build_object(
                       'name', coalesce(p.display_name, 'Member'),
                       'at', extract(epoch from t.created_at) * 1000) order by t.created_at desc), '[]'::jsonb)
                     from (select * from l1 order by created_at desc limit 5) t
                     left join public.profiles p on p.id = t.referred_user)
        ),
        jsonb_build_object(
          'level', 2,
          'count', (select count(*) from l2),
          'usdt',  (select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 2 and ref_currency = 'usdt'),
          'points',(select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 2 and ref_currency = 'points'),
          'recent',(select coalesce(jsonb_agg(jsonb_build_object(
                       'name', coalesce(p.display_name, 'Member'),
                       'at', extract(epoch from t.created_at) * 1000) order by t.created_at desc), '[]'::jsonb)
                     from (select * from l2 order by created_at desc limit 5) t
                     left join public.profiles p on p.id = t.referred_user)
        ),
        jsonb_build_object(
          'level', 3,
          'count', (select count(*) from l3),
          'usdt',  (select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 3 and ref_currency = 'usdt'),
          'points',(select coalesce(sum(amount), 0) from public.wallet_txns
                     where user_id = v_user and type = 'referral' and ref_level = 3 and ref_currency = 'points'),
          'recent',(select coalesce(jsonb_agg(jsonb_build_object(
                       'name', coalesce(p.display_name, 'Member'),
                       'at', extract(epoch from t.created_at) * 1000) order by t.created_at desc), '[]'::jsonb)
                     from (select * from l3 order by created_at desc limit 5) t
                     left join public.profiles p on p.id = t.referred_user)
        )
      ),
      'totals', jsonb_build_object(
        'usdt',  (select coalesce(sum(amount), 0) from public.wallet_txns
                   where user_id = v_user and type = 'referral' and ref_currency = 'usdt'),
        'points',(select coalesce(sum(amount), 0) from public.wallet_txns
                   where user_id = v_user and type = 'referral' and ref_currency = 'points')
      )
    )
  );
end;
$$;

revoke all on function public.referral_pyramid() from public, anon;
grant execute on function public.referral_pyramid() to authenticated;
