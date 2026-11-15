-- ============================================================
-- FlexFam · ADMIN — "How did this member earn?"            (#24)
-- ============================================================
-- How to run: Supabase Dashboard → SQL Editor → paste this ENTIRE
-- file → Run.  Safe to re-run (idempotent).
--
-- What it does
--   Adds ONE read-only, admins-only function:
--
--     admin_member_earnings(p_user, p_request, p_limit)
--
--   It creates no table, changes no row and replaces no existing
--   function, so it cannot affect balances, withdrawals or tasks.
--
-- Why
--   When a member asks for a withdrawal the admin must be able to see
--   where that money came from before paying it out. admin.html →
--   Payments → "How earned" (and every member modal) calls this
--   function and shows, for that one member:
--     • USDT in / out by source — Task Market tasks, daily streak,
--       referral income, mining claims, points → USDT, deposits,
--       escrow, rigs, withdrawals
--     • coins (points) in / out by source — campaigns, referral,
--       mining, browser import, conversions, rigs
--     • a ledger check: the entries above must add up to the
--       balance the member can actually withdraw
--     • every deposit / withdrawal request the member ever made
--     • who paid the member (task posters) and whose activity
--       produced the referral income (downline)
--     • the full money ledger (wallet + mining), newest first
--
-- Arguments (pass at least one of the first two)
--   p_user     the member's id
--   p_request  a pay_requests.id — the payments queue only knows the
--              request, so the member is looked up from it
--   p_limit    ledger rows to return (default 300, max 5000)
--
-- Run order
--   after supabase.sql (#1), supabase-mining.sql (#2) and
--   supabase-wallet.sql (#3). Campaigns (#5), daily streak (#14) and
--   the referral pyramid (#16) are optional — their sections simply
--   come back empty when those files have not been run.
-- ============================================================

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run supabase.sql first';
  end if;
  if to_regclass('public.wallet_txns') is null or to_regclass('public.pay_requests') is null then
    raise exception 'wallet tables are missing — run supabase-mining.sql and supabase-wallet.sql first';
  end if;
end $$;

create or replace function public.admin_member_earnings(
  p_user    uuid default null,
  p_request uuid default null,
  p_limit   int  default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := p_user;
  v_req       public.pay_requests;
  v_lim       int  := least(greatest(coalesce(p_limit, 300), 1), 5000);
  v_email     text;
  v_joined    timestamptz;
  v_bal       public.balances;
  v_unclaimed numeric := 0;
  v_claimed   numeric := 0;
  v_rows      jsonb := '[]'::jsonb;  -- one entry per source: {cur, key, count, amount, first, last}
  v_part      jsonb;
  v_usdt      jsonb;
  v_points    jsonb;
  v_levels    jsonb := '[]'::jsonb;
  v_downline  jsonb := '[]'::jsonb;
  v_direct    bigint := 0;
  v_streak    jsonb;
  v_ledger    jsonb;
  v_total     bigint;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  -- ---- which member? -------------------------------------------------
  if p_request is not null then
    select * into v_req from public.pay_requests where id = p_request;
    if not found then
      raise exception 'Payment request not found' using errcode = 'P0001';
    end if;
    if v_user is null then
      v_user := v_req.user_id;
    elsif v_user <> v_req.user_id then
      raise exception 'That payment request belongs to another member' using errcode = 'P0001';
    end if;
  end if;
  if v_user is null then
    raise exception 'Pass a member id or a payment request id' using errcode = 'P0001';
  end if;

  select u.email, u.created_at into v_email, v_joined from auth.users u where u.id = v_user;
  if not found then
    raise exception 'Member not found' using errcode = 'P0001';
  end if;

  select * into v_bal from public.balances where user_id = v_user;
  select a.unclaimed, a.claimed into v_unclaimed, v_claimed
    from public.mining_accounts a where a.user_id = v_user;

  -- ---- 1. wallet ledger, grouped by where the money came from --------
  -- wallet_txns.amount mixes two currencies: 'adjust' rows and referral
  -- rows with ref_currency = 'points' are COINS, everything else is USDT.
  -- Rows that never moved the spendable balance are left out:
  --   • deposit  pending / rejected  → not credited
  --   • withdraw rejected            → returned to the balance
  --   • payout                       → owner-side note; the money already
  --                                    left with the 'escrow' row
  -- to_jsonb(t) ->> 'ref_currency' reads the column without failing on a
  -- database where the referral pyramid file has not been run yet.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cur', q.cur, 'key', q.k, 'count', q.n, 'amount', q.amt,
           'first', extract(epoch from q.f) * 1000,
           'last',  extract(epoch from q.l) * 1000)), '[]'::jsonb)
    into v_part
    from (
      select x.cur, x.k, count(*) as n, sum(x.amount) as amt, min(x.at) as f, max(x.at) as l
        from (
          select t.at, t.amount,
                 case
                   when t.type = 'adjust' then 'points'
                   when t.type = 'referral' and (to_jsonb(t) ->> 'ref_currency') = 'points' then 'points'
                   else 'usdt'
                 end as cur,
                 case
                   when t.type = 'earning'  then 'tasks'
                   when t.type = 'streak'   then 'streak'
                   when t.type = 'referral' then 'referral'
                   when t.type = 'adjust'   then 'imported'
                   when t.type = 'convert'  then case when t.amount >= 0 then 'from_points' else 'to_points' end
                   when t.type = 'deposit'  then case when t.status = 'completed' then 'deposit' end
                   when t.type = 'withdraw' then case t.status when 'completed' then 'withdrawn'
                                                               when 'pending'   then 'withdraw_pending' end
                   when t.type = 'escrow'   then 'escrow'
                   when t.type = 'refund'   then 'refund'
                   when t.type = 'payout'   then null
                   when t.amount >= 0       then 'other_credit'
                   else 'other_debit'
                 end as k
            from public.wallet_txns t
           where t.user_id = v_user
        ) x
       where x.k is not null
       group by x.cur, x.k
    ) q;
  v_rows := v_rows || v_part;

  -- ---- 2. the coin side of every points ⇄ USDT conversion ------------
  -- The ledger row stores the USDT amount; the coins are in the note
  -- ("10140 points converted to USDT" / "$1.66 USDT converted to 1660 points").
  select coalesce(jsonb_agg(jsonb_build_object(
           'cur', 'points', 'key', q.k, 'count', q.n, 'amount', q.amt,
           'first', extract(epoch from q.f) * 1000,
           'last',  extract(epoch from q.l) * 1000)), '[]'::jsonb)
    into v_part
    from (
      select case when t.amount >= 0 then 'to_usdt' else 'from_usdt' end as k,
             count(*) as n,
             sum((case when t.amount >= 0 then -1 else 1 end)
                 * coalesce((regexp_match(t.note, '([0-9]+) points'))[1]::numeric, 0)) as amt,
             min(t.at) as f, max(t.at) as l
        from public.wallet_txns t
       where t.user_id = v_user and t.type = 'convert'
       group by 1
    ) q;
  v_rows := v_rows || v_part;

  -- ---- 3. mining claims + admin balance edits (mining_ledger) --------
  -- A claim row always stores the USD value; "… as N points" in the detail
  -- means it was paid in coins. Admin edits log the USDT change only — a
  -- coin edit is described in the note, so it is not itemised here.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cur', q.cur, 'key', q.k, 'count', q.n, 'amount', q.amt,
           'first', extract(epoch from q.f) * 1000,
           'last',  extract(epoch from q.l) * 1000)), '[]'::jsonb)
    into v_part
    from (
      select x.cur, x.k, count(*) as n, sum(x.amt) as amt, min(x.at) as f, max(x.at) as l
        from (
          select l.at,
                 case when l.type = 'claim' and l.detail ~ 'as [0-9]+ points' then 'points' else 'usdt' end as cur,
                 case when l.type = 'claim' then 'mining'
                      when l.amount >= 0   then 'admin_credit'
                      else 'admin_debit' end as k,
                 case when l.type = 'claim' and l.detail ~ 'as [0-9]+ points'
                      then (regexp_match(l.detail, 'as ([0-9]+) points'))[1]::numeric
                      else l.amount end as amt
            from public.mining_ledger l
           where l.user_id = v_user
             and (l.type = 'claim' or (l.type = 'admin' and l.amount <> 0))
        ) x
       group by x.cur, x.k
    ) q;
  v_rows := v_rows || v_part;

  -- ---- 4. mining rigs the member paid for ----------------------------
  -- mining_contracts knows the real currency and amount; the matching
  -- mining_ledger 'buy' row only stores the USD list price.
  select coalesce(jsonb_agg(jsonb_build_object(
           'cur', q.cur, 'key', 'rigs', 'count', q.n, 'amount', q.amt,
           'first', extract(epoch from q.f) * 1000,
           'last',  extract(epoch from q.l) * 1000)), '[]'::jsonb)
    into v_part
    from (
      select case when c.paid_with = 'points' then 'points' else 'usdt' end as cur,
             count(*) as n, -sum(c.paid_amount) as amt,
             min(c.started_at) as f, max(c.started_at) as l
        from public.mining_contracts c
       where c.user_id = v_user and c.paid_with in ('usdt', 'points') and c.paid_amount > 0
       group by 1
    ) q;
  v_rows := v_rows || v_part;

  -- ---- 5. point campaigns (optional module) --------------------------
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'cur', 'points', 'key', q.k, 'count', q.n, 'amount', q.amt,
             'first', extract(epoch from q.f) * 1000,
             'last',  extract(epoch from q.l) * 1000)), '[]'::jsonb)
      into v_part
      from (
        -- coins earned by completing other members' campaigns
        select 'campaigns' as k, count(*) as n, coalesce(sum(mc.payout), 0) as amt,
               min(coalesce(s.reviewed_at, s.at)) as f, max(coalesce(s.reviewed_at, s.at)) as l
          from public.market_campaign_subs s
          join public.market_campaigns mc on mc.id = s.campaign_id
         where s.worker = v_user and s.status = 'approved'
        having count(*) > 0
        union all
        -- coins this member paid out on campaigns they run
        select 'campaign_spend', coalesce(sum(mc.actions), 0), -coalesce(sum(mc.spent), 0),
               min(mc.created_at), max(mc.created_at)
          from public.market_campaigns mc
         where mc.owner = v_user
        having coalesce(sum(mc.spent), 0) > 0
      ) q;
    v_rows := v_rows || v_part;
  exception when undefined_table or undefined_column then
    null;
  end;

  -- ---- totals + ledger check per currency ----------------------------
  -- net = everything in − everything out. For USDT it must equal the
  -- AVAILABLE balance: money moved to "locked" (a pending withdrawal, task
  -- escrow) is already counted as "out".
  select jsonb_build_object(
           'rows', coalesce(jsonb_agg(r order by (r ->> 'amount')::numeric desc), '[]'::jsonb),
           'in',   coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric > 0), 0),
           'out',  coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric < 0), 0),
           'net',  coalesce(sum((r ->> 'amount')::numeric), 0))
    into v_usdt
    from jsonb_array_elements(v_rows) r
   where r ->> 'cur' = 'usdt';
  v_usdt := v_usdt || jsonb_build_object(
    'balance', coalesce(v_bal.usdt, 0),
    'diff',    round(coalesce(v_bal.usdt, 0) - (v_usdt ->> 'net')::numeric, 8));

  select jsonb_build_object(
           'rows', coalesce(jsonb_agg(r order by (r ->> 'amount')::numeric desc), '[]'::jsonb),
           'in',   coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric > 0), 0),
           'out',  coalesce(sum((r ->> 'amount')::numeric) filter (where (r ->> 'amount')::numeric < 0), 0),
           'net',  coalesce(sum((r ->> 'amount')::numeric), 0))
    into v_points
    from jsonb_array_elements(v_rows) r
   where r ->> 'cur' = 'points';
  v_points := v_points || jsonb_build_object(
    'balance', coalesce(v_bal.points, 0),
    'diff',    coalesce(v_bal.points, 0) - (v_points ->> 'net')::numeric);

  -- ---- referral income: by level, and by the member who produced it --
  select coalesce(jsonb_agg(jsonb_build_object(
           'level', q.lvl, 'count', q.n, 'members', q.members, 'usdt', q.usdt, 'points', q.points)
           order by q.lvl), '[]'::jsonb)
    into v_levels
    from (
      select x.lvl, count(*) as n, count(distinct x.who) as members,
             coalesce(sum(x.amount) filter (where not x.is_points), 0) as usdt,
             coalesce(sum(x.amount) filter (where x.is_points), 0) as points
        from (
          select coalesce((to_jsonb(t) ->> 'ref_level')::int, 1) as lvl, t.ref_id as who, t.amount,
                 coalesce(to_jsonb(t) ->> 'ref_currency', 'usdt') = 'points' as is_points
            from public.wallet_txns t
           where t.user_id = v_user and t.type = 'referral'
        ) x
       group by x.lvl
    ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', q.who, 'name', case when q.who is null then 'Unknown' else public.wallet_display_name(q.who) end,
           'email', (select u.email from auth.users u where u.id = q.who),
           'level', q.lvl, 'count', q.n, 'usdt', q.usdt, 'points', q.points)
           order by q.usdt desc, q.points desc), '[]'::jsonb)
    into v_downline
    from (
      select x.who, min(x.lvl) as lvl, count(*) as n,
             coalesce(sum(x.amount) filter (where not x.is_points), 0) as usdt,
             coalesce(sum(x.amount) filter (where x.is_points), 0) as points
        from (
          select coalesce((to_jsonb(t) ->> 'ref_level')::int, 1) as lvl, t.ref_id as who, t.amount,
                 coalesce(to_jsonb(t) ->> 'ref_currency', 'usdt') = 'points' as is_points
            from public.wallet_txns t
           where t.user_id = v_user and t.type = 'referral'
        ) x
       group by x.who
       order by 4 desc, 5 desc
       limit 10
    ) q;

  begin
    select count(*) into v_direct from public.referrals r where r.referrer_user = v_user;
  exception when undefined_table or undefined_column then
    v_direct := 0;
  end;

  -- ---- daily streak (optional module) --------------------------------
  begin
    select jsonb_build_object('streak', d.streak, 'best', d.best, 'claims', d.claims, 'lastDate', d.last_date)
      into v_streak
      from public.daily_streaks d where d.user_id = v_user;
  exception when undefined_table or undefined_column then
    v_streak := null;
  end;

  -- ---- full money ledger: wallet + mining, newest first --------------
  -- 'counted' = false marks rows that did not change the spendable balance
  -- (see section 1), so the page can grey them out.
  with a as (
    select t.at, 'wallet'::text as src, t.type,
           case
             when t.type = 'adjust' then 'points'
             when t.type = 'referral' and (to_jsonb(t) ->> 'ref_currency') = 'points' then 'points'
             else 'usdt'
           end as unit,
           t.amount, t.note, t.status,
           not (t.type = 'payout'
                or (t.type = 'deposit'  and t.status <> 'completed')
                or (t.type = 'withdraw' and t.status = 'rejected')) as counted
      from public.wallet_txns t
     where t.user_id = v_user
    union all
    select l.at, 'mining', l.type,
           case when l.type = 'claim' and l.detail ~ 'as [0-9]+ points' then 'points' else 'usdt' end,
           case when l.type = 'claim' and l.detail ~ 'as [0-9]+ points'
                then (regexp_match(l.detail, 'as ([0-9]+) points'))[1]::numeric
                else l.amount end,
           l.detail, 'completed', true
      from public.mining_ledger l
     where l.user_id = v_user and l.type in ('claim', 'admin')
    union all
    select c.started_at, 'mining', 'rig', c.paid_with, -c.paid_amount,
           c.name || ' · ' || c.ghs || ' GH/s for ' || c.days || ' days', 'completed', true
      from public.mining_contracts c
     where c.user_id = v_user
  ),
  top as (
    select * from a order by a.at desc limit v_lim
  )
  select (select count(*) from a),
         coalesce(jsonb_agg(jsonb_build_object(
           'at', extract(epoch from top.at) * 1000, 'src', top.src, 'type', top.type,
           'unit', top.unit, 'amount', top.amount, 'note', top.note,
           'status', top.status, 'counted', top.counted) order by top.at desc), '[]'::jsonb)
    into v_total, v_ledger
    from top;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_user, 'email', v_email, 'name', public.wallet_display_name(v_user),
      'joinedAt', extract(epoch from v_joined) * 1000),
    'request', case when v_req.id is null then null else jsonb_build_object(
      'id', v_req.id, 'kind', v_req.kind, 'amount', v_req.amount, 'fee', v_req.fee,
      'receive', v_req.receive, 'network', v_req.network, 'txid', v_req.txid,
      'address', v_req.address, 'status', v_req.status, 'adminNote', v_req.admin_note,
      'at', extract(epoch from v_req.at) * 1000,
      'settledAt', extract(epoch from v_req.settled_at) * 1000) end,
    'balance', jsonb_build_object(
      'usdt', coalesce(v_bal.usdt, 0), 'locked', coalesce(v_bal.locked, 0),
      'points', coalesce(v_bal.points, 0),
      'totalEarned', coalesce(v_bal.total_earned, 0),
      'totalDeposited', coalesce(v_bal.total_deposited, 0),
      'totalWithdrawn', coalesce(v_bal.total_withdrawn, 0),
      'miningUnclaimed', coalesce(v_unclaimed, 0), 'miningClaimed', coalesce(v_claimed, 0)),
    'usdt', v_usdt,
    'points', v_points,
    -- what the "locked" figure is made of
    'locked', jsonb_build_object(
      'withdrawals', (select coalesce(sum(p.amount), 0) from public.pay_requests p
                       where p.user_id = v_user and p.kind = 'withdraw' and p.status = 'pending'),
      'withdrawCount', (select count(*) from public.pay_requests p
                         where p.user_id = v_user and p.kind = 'withdraw' and p.status = 'pending'),
      'escrow', (select coalesce(sum(j.escrow), 0) from public.jobs j where j.owner = v_user and j.escrow > 0),
      'escrowJobs', (select count(*) from public.jobs j where j.owner = v_user and j.escrow > 0)),
    -- every deposit / withdrawal request this member ever made
    'requests', (select coalesce(jsonb_agg(q.r order by q.at desc), '[]'::jsonb) from (
      select p.at, jsonb_build_object(
               'id', p.id, 'kind', p.kind, 'amount', p.amount, 'fee', p.fee, 'receive', p.receive,
               'network', p.network, 'txid', p.txid, 'address', p.address, 'status', p.status,
               'adminNote', p.admin_note,
               'at', extract(epoch from p.at) * 1000,
               'settledAt', extract(epoch from p.settled_at) * 1000) as r
        from public.pay_requests p
       where p.user_id = v_user
       order by p.at desc
       limit 200) q),
    -- Task Market posters whose approved tasks paid this member
    'payers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'userId', q.owner, 'name', public.wallet_display_name(q.owner),
                 'email', (select u.email from auth.users u where u.id = q.owner),
                 'count', q.n, 'amount', q.amt) order by q.amt desc), '[]'::jsonb)
      from (
        select s.owner, count(*) as n, sum(s.reward) as amt
          from public.job_subs s
         where s.worker = v_user and s.status = 'approved'
         group by s.owner
         order by sum(s.reward) desc
         limit 10) q),
    'referral', jsonb_build_object('direct', v_direct, 'levels', v_levels, 'downline', v_downline),
    'streak', v_streak,
    'adminEdits', (select count(*) from public.mining_ledger l where l.user_id = v_user and l.type = 'admin'),
    'ledger', v_ledger,
    'ledgerTotal', v_total,
    'ledgerLimit', v_lim
  );
end;
$$;

-- ------------------------------------------------------------
-- Permissions — never the browser/anon role. Signed-in members may
-- call it, but the is_admin() guard above rejects everyone who is
-- not in public.admins.
-- ------------------------------------------------------------
revoke all on function public.admin_member_earnings(uuid, uuid, int) from public, anon;
grant execute on function public.admin_member_earnings(uuid, uuid, int) to authenticated;

notify pgrst, 'reload schema';
