-- ============================================================
-- FlexFam · CAMPAIGN ENGAGEMENT LIMIT
-- "kitne user tak campaign chalegi"
--
-- Creator Add Page par limit set karta hai (0 = no limit).
-- Jitne users complete kar le, campaign FULL —
--   • naya submission server par reject ("engagement limit")
--   • Earn page par card "Limit reached ⛔" + Full badge
--   • Dashboard/Admin me progress "3 / 10" dikhta hai
--
-- Ye file standalone-safe hai (watch column bhi apne aap add
-- hota hai agar missing ho). Safe to re-run.
-- RUN ORDER: supabase-campaigns.sql ke baad.
-- ============================================================

-- 0. naya column
alter table public.market_campaigns
  add column if not exists watch_secs int not null default 0;
alter table public.market_campaigns
  add column if not exists max_actions int not null default 0;

-- ------------------------------------------------------------
-- 1. campaigns_post — ab 8 params (p_max_actions added)
--    (purana 7-param version drop — overload confusion nahi)
-- ------------------------------------------------------------
drop function if exists public.campaigns_post(text, text, text, text, text, numeric, int);

create or replace function public.campaigns_post(
  p_id text, p_platform text, p_action text, p_title text, p_url text,
  p_payout numeric, p_watch_secs int default 0, p_max_actions int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  bal public.balances;
  v_id text;
begin
  if p_title is null or length(trim(p_title)) < 3 then
    raise exception 'Title must be at least 3 characters' using errcode = 'P0001';
  end if;
  if p_payout is null or p_payout < 1 then
    raise exception 'Reward must be at least 1 point' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_platform), '') = '' or coalesce(trim(p_action), '') = '' then
    raise exception 'Pick a platform and engagement type' using errcode = 'P0001';
  end if;
  if p_url is null or p_url !~ '^https?://.+\..+' then
    raise exception 'Please enter a valid URL (https://...)' using errcode = 'P0001';
  end if;
  if p_watch_secs is null or p_watch_secs < 0 or p_watch_secs > 300 then
    raise exception 'Watch time must be between 0 and 300 seconds' using errcode = 'P0001';
  end if;
  if p_max_actions is null or p_max_actions < 0 or p_max_actions > 100000 then
    raise exception 'Engagement limit must be between 0 (no limit) and 100000' using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  if bal.points < p_payout then
    raise exception 'Not enough points — you have % on the server, need %', bal.points, p_payout
      using errcode = 'P0001';
  end if;

  v_id := coalesce(nullif(trim(p_id), ''), 'm' || (extract(epoch from now()) * 1000)::bigint);
  if exists (select 1 from public.market_campaigns where id = v_id) then
    v_id := v_id || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into public.market_campaigns (id, owner, platform, action, title, url, payout, watch_secs, max_actions)
  values (v_id, v_user, trim(p_platform), trim(p_action), trim(p_title), trim(p_url),
          p_payout, greatest(0, coalesce(p_watch_secs, 0)), greatest(0, coalesce(p_max_actions, 0)));

  return public.campaigns_feed();
end;
$$;

-- ------------------------------------------------------------
-- 2. campaigns_feed — open me actions + maxActions,
--    mine me maxActions (progress ke liye)
-- ------------------------------------------------------------
create or replace function public.campaigns_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
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
    'mine', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
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
-- 3. campaigns_public_feed — actions + maxActions (Earn page
--    guest/demo listing ke liye "Full" dikhana zaroori hai)
-- ------------------------------------------------------------
create or replace function public.campaigns_public_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
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

-- ------------------------------------------------------------
-- 4. campaigns_submit_proof — LIMIT GUARD
--    (campaign row pe for update lock pehle se hai — race-safe)
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

  return public.campaigns_feed();
end;
$$;

-- ------------------------------------------------------------
-- 5. admin_campaigns_list — maxActions bhi (progress "3 / 10")
-- ------------------------------------------------------------
create or replace function public.admin_campaigns_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from public.market_campaigns),
    'campaigns', coalesce((
      select jsonb_agg(t order by t->>'created' desc)
      from (
        select jsonb_build_object(
                 'id',       c.id,
                 'title',    c.title,
                 'url',      c.url,
                 'platform', c.platform,
                 'action',   c.action,
                 'payout',   c.payout,
                 'watchSecs', c.watch_secs,
                 'maxActions', c.max_actions,
                 'active',   c.active,
                 'actions',  c.actions,
                 'spent',    c.spent,
                 'created',  c.created_at,
                 'ownerId',  c.owner,
                 'ownerName', coalesce(nullif(trim(p.display_name), ''), 'Member'),
                 'ownerEmail', coalesce(p.email, '')
               ) as t
        from public.market_campaigns c
        left join public.profiles p on p.id = c.owner
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. admin_campaigns_update — ab 9 params (p_max_actions added)
--    (purana 8-param drop — overload confusion nahi)
-- ------------------------------------------------------------
drop function if exists public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean);

create or replace function public.admin_campaigns_update(
  p_campaign   text,
  p_title      text,
  p_url        text,
  p_platform   text,
  p_action     text,
  p_payout     numeric,
  p_watch_secs int default 0,
  p_active     boolean default true,
  p_max_actions int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required' using errcode = 'P0001';
  end if;
  if p_payout is null or p_payout < 1 or p_payout > 100 then
    raise exception 'Payout must be between 1 and 100' using errcode = 'P0001';
  end if;
  if p_watch_secs is null or p_watch_secs < 0 or p_watch_secs > 300 then
    raise exception 'Watch time must be between 0 and 300 seconds' using errcode = 'P0001';
  end if;
  if p_max_actions is null or p_max_actions < 0 or p_max_actions > 100000 then
    raise exception 'Engagement limit must be between 0 (no limit) and 100000' using errcode = 'P0001';
  end if;

  update public.market_campaigns set
    title      = trim(p_title),
    url        = coalesce(nullif(trim(p_url), ''), ''),
    platform   = coalesce(nullif(trim(p_platform), ''), platform),
    action     = coalesce(nullif(trim(p_action), ''), action),
    payout     = round(p_payout::numeric, 1),
    watch_secs = p_watch_secs,
    active     = coalesce(p_active, active),
    max_actions = greatest(0, coalesce(p_max_actions, 0))
  where id = p_campaign;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0001';
  end if;

  return public.admin_campaigns_list();
end;
$$;

-- ------------------------------------------------------------
-- 7. admin_campaigns_delete — (agar supabase-admin-campaigns.sql
--    pehle nahi chala toh bhi ye file complete ho)
-- ------------------------------------------------------------
create or replace function public.admin_campaigns_delete(p_campaign text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  delete from public.market_campaigns where id = p_campaign;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0001';
  end if;

  return public.admin_campaigns_list();
end;
$$;

-- ------------------------------------------------------------
-- 8. Permissions — naye signatures
-- ------------------------------------------------------------
revoke all on function public.campaigns_post(text, text, text, text, text, numeric, int, int)                                from public, anon;
revoke all on function public.campaigns_submit_proof(text, text, text)                                                      from public, anon;
revoke all on function public.campaigns_feed()                                                                              from public, anon;
revoke all on function public.campaigns_public_feed()                                                                       from public, anon;
revoke all on function public.admin_campaigns_list()                                                                        from public, anon;
revoke all on function public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean, int)              from public, anon;
revoke all on function public.admin_campaigns_delete(text)                                                                  from public, anon;

grant execute on function public.campaigns_post(text, text, text, text, text, numeric, int, int)                            to authenticated;
grant execute on function public.campaigns_submit_proof(text, text, text)                                                    to authenticated;
grant execute on function public.campaigns_feed()                                                                            to authenticated;
grant execute on function public.campaigns_public_feed()                                                                     to authenticated;
grant execute on function public.admin_campaigns_list()                                                                      to authenticated;
grant execute on function public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean, int)            to authenticated;
grant execute on function public.admin_campaigns_delete(text)                                                                to authenticated;
