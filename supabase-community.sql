-- FlexFam — referrals, member messages (admin broadcast / DM) and the
-- admin balance editor.
--
-- HOW TO RUN: run supabase.sql (#1), supabase-mining.sql (#2) and
-- supabase-wallet.sql (#3) first, then select this ENTIRE file (Ctrl+A),
-- paste it into the Supabase SQL editor and hit Run once.
--
-- Safe to re-run as many times as you like.

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run supabase.sql first, then re-run this file';
  end if;
  if to_regclass('public.mining_plans') is null then
    raise exception 'public.mining_plans is missing — run supabase-mining.sql first, then re-run this file';
  end if;
end;
$$;

-- ============================================================
-- 1. Referrals — who invited whom
-- ============================================================
-- A referral row is written by the database when a new Auth user carries a
-- `ref_code` in their signup metadata. The browser cannot forge or edit it.

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code    text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  referred_user uuid primary key references auth.users(id) on delete cascade,
  referrer_user uuid not null references auth.users(id) on delete cascade,
  code          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user);

-- Stable, readable code derived from the account id: FF-XXXXXXXX
create or replace function public.referral_make_code(p_user uuid)
returns text language sql immutable as $$
  select 'FF-' || upper(substr(replace(p_user::text, '-', ''), 1, 8));
$$;

create or replace function public.referral_register(p_user uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  insert into public.referral_codes (user_id, code)
  values (p_user, public.referral_make_code(p_user))
  on conflict (user_id) do nothing;

  if coalesce(trim(p_code), '') = '' then return; end if;

  select user_id into v_ref from public.referral_codes where upper(code) = upper(trim(p_code));
  if v_ref is null or v_ref = p_user then return; end if;

  insert into public.referrals (referred_user, referrer_user, code)
  values (p_user, v_ref, upper(trim(p_code)))
  on conflict (referred_user) do nothing;
end;
$$;

revoke all on function public.referral_register(uuid, text) from public, anon, authenticated;

-- Backfill codes for existing accounts.
insert into public.referral_codes (user_id, code)
select u.id, public.referral_make_code(u.id) from auth.users u
on conflict (user_id) do nothing;

-- Auth trigger: create the code and honour the ref code passed at signup.
create or replace function public.handle_new_user_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.referral_register(new.id, new.raw_user_meta_data ->> 'ref_code');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_referral on auth.users;
create trigger on_auth_user_created_referral
  after insert on auth.users
  for each row execute procedure public.handle_new_user_referral();

-- What the dashboard shows the member: their own code + how many signups it
-- brought in.
create or replace function public.referral_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_code text;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  insert into public.referral_codes (user_id, code)
  values (v_user, public.referral_make_code(v_user))
  on conflict (user_id) do nothing;
  select code into v_code from public.referral_codes where user_id = v_user;
  return jsonb_build_object(
    'code', v_code,
    'count', (select count(*) from public.referrals where referrer_user = v_user),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                 'name', coalesce(p.display_name, 'Member'),
                 'at', extract(epoch from r.created_at) * 1000) order by r.created_at desc), '[]'::jsonb)
               from (select * from public.referrals where referrer_user = v_user
                     order by created_at desc limit 20) r
               left join public.profiles p on p.id = r.referred_user)
  );
end;
$$;

revoke all on function public.referral_stats() from public, anon;
grant execute on function public.referral_stats() to authenticated;

alter table public.referral_codes enable row level security;
alter table public.referrals      enable row level security;
revoke all on table public.referral_codes from anon, authenticated;
revoke all on table public.referrals      from anon, authenticated;
grant select on table public.referral_codes to authenticated;
grant select on table public.referrals      to authenticated;

drop policy if exists "own referral code"        on public.referral_codes;
drop policy if exists "own referrals"            on public.referrals;
drop policy if exists "admins read referrals"     on public.referrals;
drop policy if exists "admins read referral codes" on public.referral_codes;

create policy "own referral code" on public.referral_codes for select
  to authenticated using (user_id = auth.uid());
create policy "admins read referral codes" on public.referral_codes for select
  to authenticated using (public.is_admin());
create policy "own referrals" on public.referrals for select
  to authenticated using (referrer_user = auth.uid() or referred_user = auth.uid());
create policy "admins read referrals" on public.referrals for select
  to authenticated using (public.is_admin());

-- ============================================================
-- 2. Free starter rig now unlocks with a referral signup
-- ============================================================
-- One free rig per successful referral. No referral = no free rig.

create or replace function public.mining_free_rig_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_refs int; v_used int;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  select count(*) into v_refs from public.referrals where referrer_user = v_user;
  select count(*) into v_used from public.mining_contracts c
    join public.mining_plans p on p.key = c.plan
   where c.user_id = v_user and p.is_free;
  return jsonb_build_object('referrals', v_refs, 'used', v_used, 'unlocked', v_refs > v_used);
end;
$$;

revoke all on function public.mining_free_rig_status() from public, anon;
grant execute on function public.mining_free_rig_status() to authenticated;

create or replace function public.mining_buy_plan(p_plan text, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.mining_require_user();
  p public.mining_plans;
  v_paid jsonb;
  v_refs int;
  v_used int;
begin
  perform public.mining_accrue(v_user);

  select * into p from public.mining_plans where key = p_plan and active;
  if not found then raise exception 'Unknown mining plan' using errcode = 'P0001'; end if;

  if p.is_free then
    if exists (
      select 1 from public.mining_contracts
       where user_id = v_user and plan = p.key and status = 'active' and ends_at > now()
    ) then
      raise exception 'Your free starter rig is already running — renew it when it expires' using errcode = 'P0001';
    end if;

    select count(*) into v_refs from public.referrals where referrer_user = v_user;
    select count(*) into v_used from public.mining_contracts where user_id = v_user and plan = p.key;
    if v_refs <= v_used then
      raise exception 'Invite a friend first — the free rig unlocks when someone signs up with your referral link' using errcode = 'P0001';
    end if;
  end if;

  v_paid := public.mining_charge(v_user, p.price_usd, p_currency,
                                 'Hashrate purchase — ' || p.name);

  insert into public.mining_contracts (user_id, plan, name, ghs, days, ends_at, price_usd, paid_with, paid_amount)
  values (v_user, p.key, p.name, p.ghs, p.days, now() + (p.days || ' days')::interval,
          p.price_usd, v_paid ->> 'paid_with', (v_paid ->> 'paid_amount')::numeric);

  perform public.mining_log(v_user, 'buy',
    'Started ' || p.name || ' · ' || p.ghs || ' GH/s for ' || p.days || ' days', -p.price_usd);

  return public.mining_state();
end;
$$;

grant execute on function public.mining_buy_plan(text, text) to authenticated;

-- Slightly better free-rig economics (referral gated now).
update public.mining_plans
   set ghs = 60, days = 10, tag = 'REFERRAL FREE',
       perks = array[
         'Unlocks when a friend signs up with your referral link',
         '60 GH/s for 10 days — no payment needed',
         'Mined rewards land straight in your wallet']
 where key = 'free';

-- ============================================================
-- 3. Member messages — admin broadcast or one-to-one
-- ============================================================

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null default 'all' check (audience in ('all', 'user')),
  user_id    uuid references auth.users(id) on delete cascade,
  title      text not null default '',
  body       text not null,
  sent_by    text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists messages_user_idx    on public.messages (user_id);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.messages      enable row level security;
alter table public.message_reads enable row level security;
revoke all on table public.messages      from anon, authenticated;
revoke all on table public.message_reads from anon, authenticated;
grant select on table public.messages to authenticated;

drop policy if exists "read own messages"   on public.messages;
drop policy if exists "admins read messages" on public.messages;
create policy "read own messages" on public.messages for select
  to authenticated using (audience = 'all' or user_id = auth.uid());
create policy "admins read messages" on public.messages for select
  to authenticated using (public.is_admin());

-- Admin: send a broadcast (p_email null/empty) or a direct message.
create or replace function public.messages_admin_send(p_email text, p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_id uuid; v_audience text := 'all';
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_email), '') <> '' then
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then raise exception 'No account for %', p_email using errcode = 'P0001'; end if;
    v_audience := 'user';
  end if;

  insert into public.messages (audience, user_id, title, body, sent_by)
  values (v_audience, v_user, left(coalesce(p_title, ''), 120), p_body,
          coalesce(auth.jwt() ->> 'email', 'admin'))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'audience', v_audience,
                            'to', coalesce(lower(trim(p_email)), ''));
end;
$$;

revoke all on function public.messages_admin_send(text, text, text) from public, anon;
grant execute on function public.messages_admin_send(text, text, text) to authenticated;

-- Admin: recent sent messages, for the panel's history list.
create or replace function public.messages_admin_recent()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id, 'audience', m.audience, 'title', m.title, 'body', m.body,
            'to', coalesce(u.email, ''), 'sentBy', m.sent_by,
            'at', extract(epoch from m.created_at) * 1000) order by m.created_at desc), '[]'::jsonb)
          from (select * from public.messages order by created_at desc limit 50) m
          left join auth.users u on u.id = m.user_id);
end;
$$;

revoke all on function public.messages_admin_recent() from public, anon;
grant execute on function public.messages_admin_recent() to authenticated;

-- Member inbox.
create or replace function public.messages_inbox()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', m.id, 'audience', m.audience, 'title', m.title, 'body', m.body,
            'at', extract(epoch from m.created_at) * 1000,
            'read', r.user_id is not null) order by m.created_at desc), '[]'::jsonb)
          from (select * from public.messages
                 where audience = 'all' or user_id = v_user
                 order by created_at desc limit 50) m
          left join public.message_reads r on r.message_id = m.id and r.user_id = v_user);
end;
$$;

revoke all on function public.messages_inbox() from public, anon;
grant execute on function public.messages_inbox() to authenticated;

create or replace function public.messages_mark_read()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, v_user from public.messages m
   where (m.audience = 'all' or m.user_id = v_user)
  on conflict do nothing;
  return public.messages_inbox();
end;
$$;

revoke all on function public.messages_mark_read() from public, anon;
grant execute on function public.messages_mark_read() to authenticated;

-- ============================================================
-- 4. Admin: set a member's exact coin / USDT balance
-- ============================================================
-- mining_admin_adjust() adds or subtracts. This one writes the exact value
-- the admin typed, which is what the member editor's "Set exact" mode uses.

create or replace function public.mining_admin_set(p_email text, p_usdt numeric, p_points bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; bal public.balances; v_old public.balances;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'No account for %', p_email using errcode = 'P0001'; end if;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_old from public.balances where user_id = v_user for update;

  update public.balances
     set usdt   = round(coalesce(p_usdt, v_old.usdt), 8),
         points = coalesce(p_points, v_old.points),
         updated_at = now()
   where user_id = v_user
  returning * into bal;

  perform public.mining_log(v_user, 'admin',
    coalesce(nullif(p_note, ''), 'Balance set by an admin') ||
    ' · coins ' || v_old.points || ' → ' || bal.points ||
    ' · USDT ' || round(v_old.usdt, 4) || ' → ' || round(bal.usdt, 4),
    round(bal.usdt - v_old.usdt, 8));

  return jsonb_build_object('email', lower(p_email), 'usdt', bal.usdt, 'points', bal.points);
end;
$$;

revoke all on function public.mining_admin_set(text, numeric, bigint, text) from public, anon;
grant execute on function public.mining_admin_set(text, numeric, bigint, text) to authenticated;
