-- FlexFam — private member-support messages
--
-- Run this WHOLE file once in Supabase Dashboard → SQL Editor.
-- It is safe to re-run and does not delete messages.
--
-- What it fixes:
--   • A member support ticket gets the dedicated `admin` audience.
--   • It is excluded from every member dashboard, inbox and bell feed.
--   • Browser users have no direct SELECT permission on public.messages;
--     recipient filtering happens only inside protected RPCs.
--   • Admins continue to see all support tickets in admin.html → Messages → Inbox.
--
-- Depends on: supabase.sql + supabase-community.sql.

begin;

-- Existing projects used only `all` / `user`. Add the private admin-only
-- audience without changing or removing existing rows.
alter table public.messages drop constraint if exists messages_audience_check;
alter table public.messages add constraint messages_audience_check
  check (audience in ('all', 'user', 'admin'));

alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

-- Do not let browser sessions query the raw table. All frontend reads use
-- security-definer RPCs that derive visibility from auth.uid().
revoke all on table public.messages      from anon, authenticated;
revoke all on table public.message_reads from anon, authenticated;

drop policy if exists "read own messages"   on public.messages;
drop policy if exists "admins read messages" on public.messages;
create policy "read own messages" on public.messages for select
  to authenticated using (
    audience = 'all' or (audience = 'user' and user_id = auth.uid())
  );
create policy "admins read messages" on public.messages for select
  to authenticated using (public.is_admin());

-- Member → support: persist as an admin-only ticket. `user_id` is the
-- configured support admin, but normal member inbox/bell RPCs deliberately
-- ignore the `admin` audience.
create or replace function public.messages_member_send(p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_admin uuid;
begin
  if v_user is null then
    raise exception 'Please log in' using errcode = 'P0001';
  end if;
  if p_body is null or length(trim(p_body)) < 2 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = 'P0001';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select u.id into v_admin
    from public.admins a
    join auth.users u on lower(u.email) = lower(a.email)
   order by u.created_at
   limit 1;
  if v_admin is null then
    raise exception 'No admin is configured yet' using errcode = 'P0001';
  end if;

  insert into public.messages (audience, user_id, title, body, sent_by)
  values ('admin', v_admin, left(coalesce(p_title, ''), 120), trim(p_body),
          coalesce(nullif(v_email, ''), 'member'));

  return jsonb_build_object('ok', true);
end;
$$;

-- The sender may review only their own support-ticket history. Nothing from
-- another member, admin broadcast or private admin DM can be returned here.
create or replace function public.messages_member_sent()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
begin
  if v_user is null then
    raise exception 'Please log in' using errcode = 'P0001';
  end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', m.title, 'body', m.body,
             'at', extract(epoch from m.created_at) * 1000)
             order by m.at_ms desc), '[]'::jsonb)
    from (
      select m0.*, extract(epoch from m0.created_at) * 1000 as at_ms
        from public.messages m0
       where m0.audience = 'admin'
         and lower(m0.sent_by) = v_email
       order by m0.created_at desc
       limit 20
    ) m
  );
end;
$$;

-- Member inbox is deliberately restricted to public broadcasts and DMs sent
-- by an admin to the currently authenticated member. Support tickets are not
-- part of this result, including for non-admin users.
create or replace function public.messages_inbox()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Please log in' using errcode = 'P0001';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'audience', m.audience, 'title', m.title, 'body', m.body,
             'at', extract(epoch from m.created_at) * 1000,
             'read', r.user_id is not null) order by m.created_at desc), '[]'::jsonb)
    from (
      select * from public.messages
       where audience = 'all' or (audience = 'user' and user_id = v_user)
       order by created_at desc
       limit 50
    ) m
    left join public.message_reads r
      on r.message_id = m.id and r.user_id = v_user
  );
end;
$$;

create or replace function public.messages_mark_read()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Please log in' using errcode = 'P0001';
  end if;

  insert into public.message_reads (message_id, user_id)
  select m.id, v_user
    from public.messages m
   where m.audience = 'all' or (m.audience = 'user' and m.user_id = v_user)
  on conflict do nothing;

  return public.messages_inbox();
end;
$$;

-- `bell_mark_read()` must not write a read receipt for a message the current
-- member is not allowed to receive.
create or replace function public.bell_mark_read(p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id   text;
  v_ok   int := 0;
begin
  if v_user is null then
    raise exception 'Please log in' using errcode = 'P0001';
  end if;

  for v_id in select jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) loop
    update public.notifications
       set read = true
     where id = v_id::uuid and user_id = v_user and not read;
    if found then v_ok := v_ok + 1; end if;

    insert into public.message_reads (message_id, user_id)
    select m.id, v_user
      from public.messages m
     where m.id = v_id::uuid
       and (m.audience = 'all' or (m.audience = 'user' and m.user_id = v_user))
    on conflict do nothing;
    if found then v_ok := v_ok + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_ok);
end;
$$;

revoke all on function public.messages_member_send(text, text) from public, anon;
revoke all on function public.messages_member_sent()              from public, anon;
revoke all on function public.messages_inbox()                    from public, anon;
revoke all on function public.messages_mark_read()                from public, anon;
revoke all on function public.bell_mark_read(jsonb)               from public, anon;
grant execute on function public.messages_member_send(text, text) to authenticated;
grant execute on function public.messages_member_sent()           to authenticated;
grant execute on function public.messages_inbox()                 to authenticated;
grant execute on function public.messages_mark_read()             to authenticated;
grant execute on function public.bell_mark_read(jsonb)            to authenticated;

commit;
