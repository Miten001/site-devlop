-- ============================================================
-- LIVE STATS — landing-page ticker (Round-33)
-- Real aggregate numbers, zero PII, zero row-level data.
-- Public read via anon: counts + one rounded sum only.
--
-- Run in Supabase SQL editor (idempotent, safe to re-run).
-- ============================================================

create or replace function public.live_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    -- streak check-ins credited in the last 24h
    'claims_24h', (select count(*)
                     from public.wallet_txns
                    where type = 'streak'
                      and at >= now() - interval '24 hours'),
    -- total rewards credited to member wallets in the last 24h (USDT value)
    'paid_24h',   (select coalesce(round(sum(amount)::numeric, 2), 0)
                     from public.wallet_txns
                    where amount > 0
                      and status = 'completed'
                      and at >= now() - interval '24 hours'),
    -- campaign tasks approved in the last 24h
    'tasks_24h',  (select count(*)
                     from public.market_campaign_subs
                    where status = 'approved'
                      and coalesce(reviewed_at, at) >= now() - interval '24 hours'),
    -- total registered members
    'users_total',      (select count(*) from public.profiles),
    -- members with a live streak (claimed today or yesterday)
    'streaks_active',   (select count(*)
                           from public.daily_streaks
                          where streak > 0
                            and last_date >= current_date - 1)
  );
$$;

-- Any visitor (anon) can read the aggregates; nobody can read the rows.
grant execute on function public.live_stats() to anon, authenticated;
