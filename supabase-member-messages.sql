-- FlexFam — member support message box
--
-- KYA HAI YE: Members ab site par ek "Message" box se admin/support ko
-- direct message bhej sakte hain (complaint, rejected proof, sawaal —
-- kuch bhi). Admin ko wo message admin panel ke Messages section me
-- dikhta hai ("From: member@email"), aur admin wahan se reply kar sakta
-- hai — reply member ke Dashboard inbox me aata hai.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> is POORE
-- file ko paste karo -> Run. "Success" dikhna chahiye.
-- Depends on: supabase.sql (admins table) + supabase-community.sql
-- (messages tables). Safe to re-run (idempotent).

-- ============================================================
-- 1. Member → Admin message bhejna
-- ============================================================
create or replace function public.messages_member_send(p_title text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_admin uuid;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  if p_body is null or length(trim(p_body)) < 2 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Message is too long (max 4000 characters)' using errcode = 'P0001';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  -- pehla configured admin hi support inbox use karta hai
  select u.id into v_admin
    from public.admins a
    join auth.users u on lower(u.email) = lower(a.email)
   order by u.created_at
   limit 1;
  if v_admin is null then
    raise exception 'No admin is configured yet' using errcode = 'P0001';
  end if;

  insert into public.messages (audience, user_id, title, body, sent_by)
  values ('user', v_admin,
          left(coalesce(p_title, ''), 120),
          trim(p_body),
          coalesce(nullif(v_email, ''), 'member'));

  return jsonb_build_object('ok', true);
end;
$$;

-- ============================================================
-- 2. Member apne bheje hue support messages dekh sake
-- ============================================================
create or replace function public.messages_member_sent()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
begin
  if v_user is null then raise exception 'Please log in' using errcode = 'P0001'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', m.title, 'body', m.body,
             'at', extract(epoch from m.created_at) * 1000)
             order by m.at_ms desc), '[]'::jsonb)
    from (select m0.*, extract(epoch from m0.created_at) * 1000 as at_ms
            from public.messages m0
           where lower(m0.sent_by) = v_email
           order by m0.created_at desc
           limit 20) m
  );
end;
$$;

-- ============================================================
-- 3. Permissions — sirf login kiye hue members
-- ============================================================
revoke all on function public.messages_member_send(text, text) from public, anon;
revoke all on function public.messages_member_sent()              from public, anon;
grant execute on function public.messages_member_send(text, text) to authenticated;
grant execute on function public.messages_member_sent()              to authenticated;
