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
-- 2. Trigger — wallet event par SAHI label wali notification
--    (wallet_txns me amount ka matlab type se badalta hai:
--     streak/deposit/convert/refund = USDT $, earning/adjust = POINTS)
-- ------------------------------------------------------------
create or replace function public.wallet_credit_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind  text := 'credit';
  v_title text;
  v_body  text;
begin
  if new.amount is null or new.amount <= 0 or coalesce(new.status, '') <> 'completed' then
    return new;
  end if;

  if new.type = 'streak' then
    v_title := '💰 You earned $' || public.notify_amount_label(new.amount);
    v_body  := 'Daily check-in reward credited to your USDT wallet. Come back tomorrow!';
  elsif new.type = 'deposit' then
    v_title := '💰 Deposit confirmed — $' || public.notify_amount_label(new.amount);
    v_body  := 'Your balance has been updated.';
  elsif new.type = 'convert' then
    v_title := '💰 Points converted — $' || public.notify_amount_label(new.amount) || ' USDT';
    v_body  := 'Points moved to your USDT wallet (bonus included).';
  elsif new.type = 'refund' then
    v_title := '↩️ Refund credited — $' || public.notify_amount_label(new.amount);
    v_body  := 'Escrow returned to your wallet.';
  elsif new.type = 'earning' then
    -- job/task rewards POINTS me hote hain — $ claim GALAT hai
    v_title := '🎯 Task reward: +' || public.notify_amount_label(new.amount) || ' pts';
    v_body  := 'Task approved — points added to your balance. 1,000 pts = $1 USDT.';
  elsif new.type = 'adjust' then
    v_kind := 'system';
    v_title := '⚙️ Balance adjusted: +' || public.notify_amount_label(new.amount) || ' pts';
    v_body  := 'Your points balance was updated.';
  else
    -- unknown type — koi $ claim nahi
    v_kind := 'system';
    v_title := '✅ Wallet updated';
    v_body  := 'A balance change was credited to your account.';
  end if;

  insert into public.notifications (user_id, kind, title, body)
  values (new.user_id, v_kind, v_title, v_body);

  return new;
end;
$$;

drop trigger if exists wallet_txns_credit_notify on public.wallet_txns;
create trigger wallet_txns_credit_notify
  after insert on public.wallet_txns
  for each row execute function public.wallet_credit_notify();

-- Purani galat-labeled notifications ("$ earned" jo points the) hata do
-- — naya trigger ab sahi labels banayega.
delete from public.notifications where kind = 'credit';

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
     where m.audience = 'all'
        or (m.audience = 'user' and m.user_id = v_user)
     order by m.created_at desc
     limit 30)
  ) s;

  select
    (select count(*) from public.notifications
      where user_id = v_user and not read)
    +
    (select count(*) from public.messages m
      where (m.audience = 'all' or (m.audience = 'user' and m.user_id = v_user))
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

    /* Only create a read receipt for a message that this member can actually
       receive. Admin-only support tickets must not be observable from a
       member session. */
    insert into public.message_reads (message_id, user_id)
    select m.id, v_user
      from public.messages m
     where m.id = v_id::uuid
       and (m.audience = 'all' or (m.audience = 'user' and m.user_id = v_user))
    on conflict (message_id, user_id) do nothing;
    if found then v_ok := v_ok + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_ok);
end;
$$;

revoke all on function public.bell_feed()                from public, anon;
revoke all on function public.bell_mark_read(jsonb)      from public, anon;
grant  execute on function public.bell_feed()            to authenticated;
grant  execute on function public.bell_mark_read(jsonb)  to authenticated;
