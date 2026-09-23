-- FlexFam — server-side point campaigns (Supabase / Postgres)
--
-- KYA HAI YE: "Add Page" (add.html) se bane campaigns ab tak sirf browser ke
-- localStorage mein save hote the, isliye dusre users ko kabhi nahi dikhte the.
-- Ye migration campaigns ko Postgres mein laata hai — bilkul task marketplace
-- (jobs_post / jobs_feed) jaisa. Ab ek user campaign banayega to SAB ko dikhega.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> is POORE file ko
-- paste karo -> Run. Supabase-wallet.sql pehle se installed hona chahiye
-- (task marketplace chal raha hai to ye already hai).
--
-- Safe to re-run as many times as you like.
-- ORDER: supabase.sql -> supabase-mining.sql -> supabase-wallet.sql -> (ye file)

-- ============================================================
-- 0. Prerequisites
-- ============================================================
do $$
begin
  if to_regprocedure('public.wallet_require_user()') is null then
    raise exception 'public.wallet_require_user() is missing — run supabase-wallet.sql first';
  end if;
  if to_regclass('public.balances') is null then
    raise exception 'public.balances is missing — run supabase-mining.sql first';
  end if;
end;
$$;

-- ============================================================
-- 1. Tables
-- NOTE: naam "market_campaigns" hai kyunki "campaigns" table pehle se
-- analytics (ff-analytics.js) ke liye exist karta hai — conflict se bachne.
-- ============================================================
create table if not exists public.market_campaigns (
  id         text primary key,
  owner      uuid not null references auth.users(id) on delete cascade,
  platform   text not null,
  action     text not null,
  title      text not null,
  url        text not null default '',
  payout     numeric not null default 0 check (payout >= 0),
  active     boolean not null default true,
  actions    int not null default 0,
  spent      numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.market_campaign_subs (
  id          uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.market_campaigns(id) on delete cascade,
  worker      uuid not null references auth.users(id) on delete cascade,
  proof       text not null,
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason      text not null default '',
  at          timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (campaign_id, worker)
);

-- Browser se direct koi read/write nahi — sab kuch niche wale
-- security definer RPCs ke through jaata hai (wallet tables jaisa).
alter table public.market_campaigns      enable row level security;
alter table public.market_campaign_subs  enable row level security;

-- ============================================================
-- 2. Feed — poora campaign state ek call mein
--    (jobs_feed() ka campaigns version)
-- ============================================================
create or replace function public.campaigns_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    -- live campaigns (sabki — Earn page unhe complete kar sakta hai)
    'open', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'mine', (c.owner = v_user), 'active', c.active,
        'authorEmail', au.email,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c join auth.users au on au.id = c.owner
      where c.active
    ) o),
    -- mere post kiye hue campaigns (Dashboard "My campaigns")
    'mine', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'mine', true, 'active', c.active,
        'authorEmail', au.email, 'actions', c.actions, 'spent', c.spent,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c join auth.users au on au.id = c.owner
      where c.owner = v_user
    ) m),
    -- maine jin campaigns mein proof bheja
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
    -- mere campaigns par aaye proofs (owner review queue)
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
    -- ye campaigns maine complete kar liye (approve ho chuke)
    'done', (select coalesce(jsonb_agg(distinct s.campaign_id), '[]'::jsonb)
      from public.market_campaign_subs s
      where s.worker = v_user and s.status = 'approved')
  );
end;
$$;

-- ============================================================
-- 3. Campaign create (add.html "Launch Campaign")
--    Points abhi deduct NAHI hote — approval ke waqt jaate hain
--    (browser version jaisa hi behaviour). Bas pehli payout ke
--    liye itne points hone chahiye.
-- ============================================================
create or replace function public.campaigns_post(
  p_id text, p_platform text, p_action text, p_title text, p_url text, p_payout numeric)
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

  insert into public.market_campaigns (id, owner, platform, action, title, url, payout)
  values (v_id, v_user, trim(p_platform), trim(p_action), trim(p_title), trim(p_url), p_payout);

  return public.campaigns_feed();
end;
$$;

-- ============================================================
-- 4. Proof submit (Earn page worker side)
--    Reject hone par dobara submit kar sakte hain (browser jaisa).
-- ============================================================
create or replace function public.campaigns_submit_proof(p_campaign text, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  c public.market_campaigns;
  s public.market_campaign_subs;
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
    update public.market_campaign_subs
       set proof = trim(p_proof), note = coalesce(trim(p_note), ''),
           status = 'pending', reason = '', at = now(), reviewed_at = null
     where id = s.id;
  else
    insert into public.market_campaign_subs (campaign_id, worker, proof, note)
    values (p_campaign, v_user, trim(p_proof), coalesce(trim(p_note), ''));
  end if;

  return public.campaigns_feed();
end;
$$;

-- ============================================================
-- 5. Owner review (Dashboard approve / reject)
--    Approve = owner se points minus, worker ko plus — ek hi
--    transaction mein, double-pay kabhi nahi ho sakta.
-- ============================================================
create or replace function public.campaigns_review(p_sub uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  s public.market_campaign_subs;
  c public.market_campaigns;
  bal public.balances;
begin
  select * into s from public.market_campaign_subs where id = p_sub for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0001'; end if;
  if s.status <> 'pending' then raise exception 'Already reviewed' using errcode = 'P0001'; end if;

  select * into c from public.market_campaigns where id = s.campaign_id for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  if c.owner <> v_user then
    raise exception 'Only the campaign owner can review this proof' using errcode = 'P0001';
  end if;

  update public.market_campaign_subs
     set status = case when p_approve then 'approved' else 'rejected' end,
         reason = coalesce(p_reason, ''),
         reviewed_at = now()
   where id = p_sub;

  if p_approve then
    insert into public.balances (user_id) values (c.owner) on conflict (user_id) do nothing;
    select * into bal from public.balances where user_id = c.owner for update;
    if bal.points < c.payout then
      raise exception 'Not enough points in your balance to pay this reward'
        using errcode = 'P0001';
    end if;

    update public.balances
       set points = points - c.payout, updated_at = now()
     where user_id = c.owner;

    insert into public.balances (user_id) values (s.worker) on conflict (user_id) do nothing;
    update public.balances
       set points = points + c.payout, updated_at = now()
     where user_id = s.worker;

    update public.market_campaigns
       set actions = actions + 1, spent = round(spent + c.payout, 2)
     where id = c.id;
  end if;

  return public.campaigns_feed();
end;
$$;

-- ============================================================
-- 6. Pause / resume + delete (Dashboard buttons)
-- ============================================================
create or replace function public.campaigns_toggle(p_campaign text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  update public.market_campaigns set active = p_active
   where id = p_campaign and owner = v_user;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  return public.campaigns_feed();
end;
$$;

create or replace function public.campaigns_delete(p_campaign text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  delete from public.market_campaigns where id = p_campaign and owner = v_user;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  return public.campaigns_feed();
end;
$$;

-- ============================================================
-- 7. Permissions — sirf login kiye hue members, browser/anon ko nahi
-- ============================================================
revoke all on function public.campaigns_feed()                        from public, anon;
revoke all on function public.campaigns_post(text, text, text, text, text, numeric) from public, anon;
revoke all on function public.campaigns_submit_proof(text, text, text) from public, anon;
revoke all on function public.campaigns_review(uuid, boolean, text)   from public, anon;
revoke all on function public.campaigns_toggle(text, boolean)         from public, anon;
revoke all on function public.campaigns_delete(text)                  from public, anon;

grant execute on function public.campaigns_feed()                        to authenticated;
grant execute on function public.campaigns_post(text, text, text, text, text, numeric) to authenticated;
grant execute on function public.campaigns_submit_proof(text, text, text) to authenticated;
grant execute on function public.campaigns_review(uuid, boolean, text)   to authenticated;
grant execute on function public.campaigns_toggle(text, boolean)         to authenticated;
grant execute on function public.campaigns_delete(text)                  to authenticated;
