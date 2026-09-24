-- ============================================================
-- FlexFam — WATCH-TIMER campaigns + AUTO-APPROVE (ek hi migration)
--
-- KYA NAYA HAI:
--   1. market_campaigns me watch_secs column — Visit/Watch/Read
--      type campaigns me user ko itne SECOND page dekhna padta hai,
--      tabhi points milte hain (Earn page par timer).
--   2. campaigns_post me p_watch_secs param — Add Page se set hota hai.
--   3. Saare feed functions watchSecs return karte hain.
--   4. campaigns_submit_proof = AUTO-APPROVE (proof submit karte hi
--      points turant — owner review nahi). [agar pehle se chal chuka
--      hai to re-run karna safe hai]
--
-- RUN ORDER: supabase-campaigns.sql ke BAAD. Ek hi baar chalao.
-- ============================================================

-- 1) Column
alter table public.market_campaigns
  add column if not exists watch_secs int not null default 0;

-- 2) Campaign post — ab watch time bhi set hota hai
create or replace function public.campaigns_post(p_id text, p_platform text, p_action text, p_title text, p_url text, p_payout numeric, p_watch_secs int default 0)
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

  insert into public.market_campaigns (id, owner, platform, action, title, url, payout, watch_secs)
  values (v_id, v_user, trim(p_platform), trim(p_action), trim(p_title), trim(p_url), p_payout, greatest(0, coalesce(p_watch_secs, 0)));

  return public.campaigns_feed();
end;
$$;

-- 3) Feed — watchSecs bhi return hota hai
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
        'mine', true, 'active', c.active,
        'authorEmail', au.email, 'actions', c.actions, 'spent', c.spent,
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

-- 4) Public feed — guests/demo ko bhi watchSecs dikhe (timer ke liye)
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
        'mine', false, 'active', c.active,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c
      where c.active
    ) o)
  );
end;
$$;

revoke all on function public.campaigns_public_feed() from public;
grant execute on function public.campaigns_public_feed() to anon, authenticated;

-- 5) Admin member detail — watchSecs bhi
create or replace function public.admin_member_detail(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  if p_user is null then
    raise exception 'Which member?' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'watchSecs', c.watch_secs,
        'active', c.active, 'actions', c.actions, 'spent', c.spent,
        'created', extract(epoch from c.created_at) * 1000
      ) order by c.created_at desc), '[]'::jsonb)
      from public.market_campaigns c
      where c.owner = p_user),
    'subs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'campaignId', s.campaign_id,
        'campaignTitle', c.title, 'platform', c.platform,
        'payout', c.payout, 'status', s.status, 'reason', s.reason,
        'proof', s.proof, 'note', s.note,
        'at', extract(epoch from s.at) * 1000,
        'reviewedAt', case when s.reviewed_at is null then 0
                           else extract(epoch from s.reviewed_at) * 1000 end
      ) order by s.at desc), '[]'::jsonb)
      from public.market_campaign_subs s
      join public.market_campaigns c on c.id = s.campaign_id
      where s.worker = p_user)
  );
end;
$$;

revoke all on function public.admin_member_detail(uuid) from public, anon;
grant execute on function public.admin_member_detail(uuid) to authenticated;

-- 6) AUTO-APPROVE submit — proof submit karte hi points (owner review nahi)
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

revoke all on function public.campaigns_submit_proof(text, text, text) from public, anon;
grant execute on function public.campaigns_submit_proof(text, text, text) to authenticated;
