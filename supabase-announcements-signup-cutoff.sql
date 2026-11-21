-- After supabase-community.sql and supabase-notifications.sql. Safe to rerun.
begin;
-- Account creation time is authoritative, not browser/cache time.
create or replace function public.member_joined_at()
returns timestamptz language sql stable security definer set search_path = public as $$
 select created_at from auth.users where id = auth.uid();
$$;
revoke all on function public.member_joined_at() from public, anon;
grant execute on function public.member_joined_at() to authenticated;


drop policy if exists "read own messages" on public.messages;
create policy "read own messages" on public.messages for select to authenticated
using ((audience = 'all' and created_at >= public.member_joined_at()) or user_id = auth.uid());

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
                 where (audience = 'all' and created_at >= public.member_joined_at()) or user_id = v_user
                 order by created_at desc limit 50) m
          left join public.message_reads r on r.message_id = m.id and r.user_id = v_user);
end;
$$;

create or replace function public.messages_mark_read()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, v_user from public.messages m
   where ((m.audience = 'all' and m.created_at >= public.member_joined_at()) or m.user_id = v_user)
  on conflict do nothing;
  return public.messages_inbox();
end;
$$;

create or replace function public.messages_mark_one_read(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, v_user from public.messages m
   where m.id = p_id and ((m.audience = 'all' and m.created_at >= public.member_joined_at()) or m.user_id = v_user)
  on conflict (message_id, user_id) do nothing;
  return public.messages_inbox();
end;
$$;

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

notify pgrst, 'reload schema';
commit;
