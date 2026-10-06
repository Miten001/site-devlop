-- ============================================================
-- FlexFam · CAMPAIGN TOP BID FIRST   (#22)
--
-- Jis campaign par member ne jyada coin / USDT (payout) bid kiya
-- hai wo Earn page par SABSE PEHLE dikhti hai. Barabar payout ho
-- to nayi campaign upar.
--
-- Safe to re-run. RUN ORDER: supabase-campaigns-limit.sql ke baad.
-- ============================================================

create or replace function public.campaigns_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(c order by (c ->> 'payout')::numeric desc,
                                                  (c ->> 'created')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'watchSecs', c.watch_secs,
        'actions', c.actions, 'maxActions', c.max_actions,
        'mine', (c.owner = v_user), 'active', c.active,
        'authorEmail', au.email,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c join auth.users au on au.id = c.owner
      where c.active
    ) o),
    'mine', (select coalesce(jsonb_agg(c order by (c ->> 'payout')::numeric desc,
                                                  (c ->> 'created')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'watchSecs', c.watch_secs,
        'actions', c.actions, 'spent', c.spent, 'maxActions', c.max_actions,
        'mine', true, 'active', c.active,
        'authorEmail', au.email,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c join auth.users au on au.id = c.owner
      where c.owner = v_user
    ) m),
    'mySubs', (select coalesce(jsonb_agg(s order by s ->> 'at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', s.id, 'campaignId', s.campaign_id, 'campaignTitle', c.title,
        'payout', c.payout, 'proof', s.proof, 'note', s.note,
        'status', s.status, 'reason', s.reason,
        'at', extract(epoch from s.at) * 1000) as s
      from public.market_campaign_subs s
      join public.market_campaigns c on c.id = s.campaign_id
      where s.worker = v_user
    ) ms),
    'inbox', (select coalesce(jsonb_agg(s order by s ->> 'at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', s.id, 'campaignId', s.campaign_id, 'campaignTitle', c.title,
        'payout', c.payout, 'workerName', public.wallet_display_name(s.worker),
        'workerEmail', au.email,
        'proof', s.proof, 'note', s.note,
        'status', s.status, 'at', extract(epoch from s.at) * 1000) as s
      from public.market_campaign_subs s
      join public.market_campaigns c on c.id = s.campaign_id
      join auth.users au on au.id = s.worker
      where c.owner = v_user and s.status = 'pending'
    ) i),
    'done', (select coalesce(jsonb_agg(distinct s.campaign_id), '[]'::jsonb)
      from public.market_campaign_subs s
      where s.worker = v_user and s.status = 'approved')
  );
end;
$$;

create or replace function public.campaigns_public_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(c order by (c ->> 'payout')::numeric desc,
                                                  (c ->> 'created')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'watchSecs', c.watch_secs,
        'actions', c.actions, 'maxActions', c.max_actions,
        'mine', false, 'active', c.active,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c
      where c.active
    ) o)
  );
end;
$$;

revoke all on function public.campaigns_feed()        from public, anon;
revoke all on function public.campaigns_public_feed() from public;
grant execute on function public.campaigns_feed()        to authenticated;
grant execute on function public.campaigns_public_feed() to anon, authenticated;

notify pgrst, 'reload schema';
