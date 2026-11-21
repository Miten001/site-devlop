-- ============================================================
-- FLEXFAM — NOTIFICATIONS + BELL ICON (Round-35)
--
-- KYA HAI YE:
--   1. `notifications` table — har member ke personal events
--      (credit mila, mining claim, referral income…).
--   2. TRIGGER on wallet_txns — jis second kisi member ko
--      reward/payout credited hota hai, usi second ek
--      notification ban jaati hai ("💰 You earned $X").
--   3. bell_feed() — bell icon ka merged feed: notifications +
--      admin broadcasts / DMs (messages table), unread count ke
--      saath.
--   4. bell_mark_read() — open karne par read mark.
--
-- DEPENDS ON: supabase-wallet.sql (wallet_txns),
--             supabase-community.sql (messages, message_reads).
-- Safe to re-run (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table — member's own notifications
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'credit' check (kind in ('credit','system')),
  title      text not null default '',
  body       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Member: sirf apni rows padh sakta hai, sirf read-flag toggle
-- kar sakta hai. Insert/delete par direct access nahi — rows
-- sirf triggers / admin RPCs (definer) se aati hain.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 1b. Amount label helper — "10" -> "10", "5.50" -> "5.5", "0.011" -> "0.011"
-- ------------------------------------------------------------
create or replace function public.notify_amount_label(p_amount numeric)
returns text language sql immutable as $$
  select case
           when p_amount = floor(p_amount) then p_amount::text
           else trim(trailing '0' from p_amount::text)
         end;
$$;

-- ------------------------------------------------------------
-- 2. Deposit & Withdrawal Notifications ONLY
--    - General wallet balance credits (tasks, mining, streaks,
--      referrals, quests, spins, promos, VIP bonuses, adjusts)
--      do NOT create "Wallet updated" bell notifications.
--    - ONLY deposit & withdrawal lifecycle events on
--      public.pay_requests (submitted / approved / rejected)
--      notify the member in the bell.
-- ------------------------------------------------------------
drop trigger if exists wallet_txns_credit_notify on public.wallet_txns;

create or replace function public.wallet_credit_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  return new;
end;
$$;

create or replace function public.pay_request_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_amt   text := public.notify_amount_label(round(coalesce(new.amount, 0), 2));
  v_net   text := coalesce(nullif(trim(new.network), ''), 'USDT');
  v_note  text := trim(coalesce(new.admin_note, ''));
  v_kind  text := 'system';
  v_title text;
  v_body  text;
begin
  if new.kind not in ('deposit', 'withdraw') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      return new;
    end if;
    if new.kind = 'deposit' then
      v_title := '⏳ Deposit submitted — $' || v_amt || ' USDT';
      v_body  := 'Your $' || v_amt || ' USDT deposit via ' || v_net || ' is waiting for admin confirmation.';
    else
      v_title := '⏳ Withdrawal requested — $' || v_amt || ' USDT';
      v_body  := 'Your $' || v_amt || ' USDT withdrawal via ' || v_net || ' is waiting for approval.';
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(old.status, '') = coalesce(new.status, '') then
      return new;
    end if;
    if new.kind = 'deposit' then
      if new.status = 'approved' then
        v_kind  := 'credit';
        v_title := '✅ Deposit approved — $' || v_amt || ' USDT';
        v_body  := 'Your $' || v_amt || ' USDT deposit via ' || v_net || ' has been credited to your wallet.';
      elsif new.status = 'rejected' then
        v_title := '❌ Deposit rejected — $' || v_amt || ' USDT';
        v_body  := 'Your $' || v_amt || ' USDT deposit via ' || v_net || ' was rejected.';
      else
        return new;
      end if;
    else
      if new.status = 'approved' then
        v_kind  := 'credit';
        v_title := '💸 Withdrawal approved — $' || v_amt || ' USDT';
        v_body  := 'Your $' || v_amt || ' USDT withdrawal via ' || v_net || ' has been approved and processed.';
      elsif new.status = 'rejected' then
        v_title := '↩️ Withdrawal rejected — $' || v_amt || ' USDT';
        v_body  := 'Your $' || v_amt || ' USDT withdrawal via ' || v_net || ' was rejected and refunded to your available balance.';
      else
        return new;
      end if;
    end if;
    if v_note <> '' then
      v_body := v_body || ' Note: ' || v_note;
    end if;
  else
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body)
  values (new.user_id, v_kind, v_title, v_body);

  return new;
end;
$$;

drop trigger if exists pay_requests_notify_trigger on public.pay_requests;
create trigger pay_requests_notify_trigger
  after insert or update of status on public.pay_requests
  for each row execute function public.pay_request_notify();

-- Remove old auto-generated wallet-balance notification spam while
-- leaving admin announcements & DMs (public.messages) untouched.
delete from public.notifications
 where title like '✅ Wallet updated%'
    or title like '⚙️ Balance adjusted%'
    or title like '💰%'
    or title like '🎯%'
    or title like '↩️ Refund credited%';

-- ------------------------------------------------------------
-- 3. bell_feed() — bell icon ka poora data ek call me
--    (notifications + broadcasts/DMs, newest first, unread count)
-- ------------------------------------------------------------
create or replace function public.bell_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_items jsonb;
  v_unread int;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(t order by t->>'at' desc), '[]'::jsonb) into v_items
  from (
    (select jsonb_build_object(
             'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
             'read', n.read, 'at', extract(epoch from n.created_at) * 1000
           ) as t
      from public.notifications n
     where n.user_id = v_user
     order by n.created_at desc
     limit 60)
    union all
    (select jsonb_build_object(
             'id', m.id, 'kind',
             case when m.audience = 'user' then 'dm' else 'broadcast' end,
             'title', m.title, 'body', m.body,
             'read', (r.user_id is not null),
             'at', extract(epoch from m.created_at) * 1000
           ) as t
      from public.messages m
      left join public.message_reads r
             on r.message_id = m.id and r.user_id = v_user
     where (m.audience = 'all' and m.created_at >= public.member_joined_at())
        or (m.audience = 'user' and m.user_id = v_user)
     order by m.created_at desc
     limit 30)
  ) s;

  select
    (select count(*) from public.notifications
      where user_id = v_user and not read)
    +
    (select count(*) from public.messages m
      where ((m.audience = 'all' and m.created_at >= public.member_joined_at()) or (m.audience = 'user' and m.user_id = v_user))
        and not exists (select 1 from public.message_reads r
                         where r.message_id = m.id and r.user_id = v_user))
    into v_unread;

  return jsonb_build_object('unread', v_unread, 'items', v_items);
end;
$$;

-- ------------------------------------------------------------
-- 4. bell_mark_read(p_ids) — visible items ko read mark karo
--    p_ids = ["<notification-or-message-uuid>", …]
-- ------------------------------------------------------------
create or replace function public.bell_mark_read(p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id   text;
  v_ok   int := 0;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;

  for v_id in select jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) loop
    update public.notifications
       set read = true
     where id = v_id::uuid and user_id = v_user and not read;
    if found then v_ok := v_ok + 1; end if;

    -- sirf message ids ke liye read-mark (notifications FK todenge)
    if exists (select 1 from public.messages where id = v_id::uuid and ((audience = 'all' and created_at >= public.member_joined_at()) or user_id = v_user)) then
      insert into public.message_reads (message_id, user_id)
      values (v_id::uuid, v_user)
      on conflict (message_id, user_id) do nothing;
      if found then v_ok := v_ok + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_ok);
end;
$$;

revoke all on function public.bell_feed()                from public, anon;
revoke all on function public.bell_mark_read(jsonb)      from public, anon;
grant  execute on function public.bell_feed()            to authenticated;
grant  execute on function public.bell_mark_read(jsonb)  to authenticated;
