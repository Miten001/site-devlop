-- ============================================================
-- FlexFam · HIDE COMPLETED TASKS FOR THE WORKER   (#26)
--
-- 1. campaigns_feed(): omits Add Page campaigns that the signed-in
--    member has already completed (approved) or submitted (pending)
--    from the 'open' list so finished tasks never linger on screen.
--    Rejected submissions remain visible so the member can retry,
--    and campaign owners still see their own campaigns.
--
-- 2. jobs_feed(): keeps micro-jobs the member has already submitted
--    out of 'open' and also requires jb.escrow >= jb.reward so
--    exhausted/unfunded jobs never appear in the open market.
--
-- Safe to re-run (idempotent, no tables or rows modified).
-- RUN ORDER: after #21 (supabase-post-task-admin.sql) and
--            #22 (supabase-campaigns-top-bid.sql).
-- ============================================================

-- ------------------------------------------------------------
-- 1. campaigns_feed — hide completed / pending campaigns from 'open'
-- ------------------------------------------------------------
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
        and not exists (
          select 1 from public.market_campaign_subs s
           where s.campaign_id = c.id
             and s.worker = v_user
             and s.status in ('approved', 'pending')
        )
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

-- ------------------------------------------------------------
-- 2. jobs_feed — hide submitted / full / escrow-exhausted micro-jobs
-- ------------------------------------------------------------
create or replace function public.jobs_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name, 'color', color) order by sort), '[]'::jsonb)
      from public.job_categories),
    'config', jsonb_build_object(
      'platformFeePct', (select platform_fee_pct from public.wallet_config where id = 1),
      'minJobReward', (select min_job_reward from public.wallet_config where id = 1)),
    'quota', jsonb_build_object(
      'max', 3,
      'byCategory', coalesce((
        select jsonb_object_agg(cat, n)
        from (
          select category as cat, count(*) as n
          from public.jobs
          where owner = v_user and status in ('active', 'paused')
          group by category
        ) q
      ), '{}'::jsonb)
    ),
    'availableRewards', (select coalesce(sum(least(jb.escrow, jb.reward * greatest(0, jb.slots - jb.filled))), 0)
      from public.jobs jb
      where jb.status = 'active' and jb.filled < jb.slots and jb.escrow >= jb.reward
        and jb.owner <> v_user
        and not exists (select 1 from public.job_subs s where s.job_id = jb.id and s.worker = v_user)),
    'open', (select coalesce(jsonb_agg(j order by (j ->> 'reward')::numeric desc,
                                                  (j ->> 'createdAt')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'escrow', jb.escrow, 'ownerName', public.wallet_display_name(jb.owner),
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb
        where jb.status = 'active' and jb.filled < jb.slots and jb.escrow >= jb.reward
          and jb.owner <> v_user
          and not exists (select 1 from public.job_subs s where s.job_id = jb.id and s.worker = v_user)
      ) o),
    'mine', (select coalesce(jsonb_agg(j order by j ->> 'createdAt' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'escrow', jb.escrow, 'fee', jb.fee, 'status', jb.status,
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb where jb.owner = v_user
      ) m),
    'mySubs', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'proof', s.proof, 'note', s.note, 'status', s.status, 'reason', s.reason,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.worker = v_user
      ) ms),
    'inbox', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'workerName', public.wallet_display_name(s.worker),
          'proof', s.proof, 'note', s.note, 'status', s.status,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.owner = v_user and s.status = 'pending'
      ) i),
    'history', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'workerName', public.wallet_display_name(s.worker),
          'proof', s.proof, 'note', s.note, 'status', s.status, 'reason', s.reason,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.owner = v_user
        order by s.at desc limit 200
      ) h)
  );
end;
$$;

revoke all on function public.campaigns_feed() from public, anon;
revoke all on function public.jobs_feed()      from public, anon;
grant execute on function public.campaigns_feed() to authenticated;
grant execute on function public.jobs_feed()      to authenticated;

notify pgrst, 'reload schema';
