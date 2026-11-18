-- Support tickets: run after supabase.sql (public.is_admin).
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('deposit','withdrawal','task','account','other')),
  subject text not null check (length(subject) between 3 and 120),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);
create table if not exists public.support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  is_staff boolean not null default false,
  body text not null check (length(body) between 2 and 4000),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.support_tickets alter column created_at set default clock_timestamp();
alter table public.support_replies alter column created_at set default clock_timestamp();
create index if not exists support_tickets_owner on public.support_tickets(user_id, updated_at desc);
create index if not exists support_replies_thread on public.support_replies(ticket_id, created_at);
alter table public.support_tickets enable row level security;
alter table public.support_replies enable row level security;
drop policy if exists support_ticket_read on public.support_tickets;
create policy support_ticket_read on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists support_reply_read on public.support_replies;
create policy support_reply_read on public.support_replies for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and (t.user_id = auth.uid() or public.is_admin())));
revoke all on public.support_tickets, public.support_replies from anon, authenticated;
grant select on public.support_tickets, public.support_replies to authenticated;

create or replace function public.support_list(p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff boolean := coalesce(public.is_admin(), false); v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_status is not null and p_status not in ('open','in_progress','resolved') then raise exception 'Invalid status'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb) into v_rows
  from (select * from public.support_tickets where (user_id = auth.uid() or v_staff)
    and (p_status is null or status = p_status) order by updated_at desc limit 200) t;
  return jsonb_build_object('isAdmin', v_staff, 'tickets', v_rows);
end; $$;

create or replace function public.support_thread(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket public.support_tickets; v_replies jsonb;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket and (user_id = auth.uid() or coalesce(public.is_admin(),false));
  if not found then raise exception 'Ticket not found or access denied'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb) into v_replies
    from public.support_replies r where ticket_id = p_ticket;
  return jsonb_build_object('ticket', to_jsonb(v_ticket), 'replies', v_replies);
end; $$;

create or replace function public.support_create(p_category text, p_subject text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in'; end if;
  if p_category is null or p_category not in ('deposit','withdrawal','task','account','other') then raise exception 'Invalid category'; end if;
  if p_subject is null or length(trim(p_subject)) not between 3 and 120 then raise exception 'Subject must be 3–120 characters'; end if;
  if p_body is null or length(trim(p_body)) not between 2 and 4000 then raise exception 'Message must be 2–4000 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 29));
  if (select count(*) from public.support_tickets where user_id=v_uid and created_at > now()-interval '1 day') >= 10 then
    raise exception 'Daily ticket limit reached. Reply to an existing ticket instead.';
  end if;
  insert into public.support_tickets(user_id,category,subject) values(v_uid,p_category,trim(p_subject)) returning id into v_id;
  insert into public.support_replies(ticket_id,author_id,body) values(v_id,v_uid,trim(p_body));
  return v_id;
end; $$;

create or replace function public.support_respond(p_ticket uuid, p_body text default '', p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket public.support_tickets; v_staff boolean := coalesce(public.is_admin(),false); v_body text := trim(coalesce(p_body,''));
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into v_ticket from public.support_tickets where id=p_ticket and (user_id=auth.uid() or v_staff) for update;
  if not found then raise exception 'Ticket not found or access denied'; end if;
  if p_status is not null and (not v_staff or p_status not in ('open','in_progress','resolved')) then raise exception 'Only admins can change ticket status'; end if;
  if length(v_body)>4000 or (length(v_body)>0 and length(v_body)<2) then raise exception 'Message must be 2–4000 characters'; end if;
  if v_body='' and p_status is null then raise exception 'Write a reply first'; end if;
  if not v_staff and v_ticket.status='resolved' then raise exception 'This ticket is resolved. Create a new ticket for further help.'; end if;
  if v_body<>'' then
    if exists(select 1 from public.support_replies where author_id=auth.uid() and ticket_id=p_ticket and created_at>clock_timestamp()-interval '5 seconds') then raise exception 'Please wait a few seconds before replying'; end if;
    insert into public.support_replies(ticket_id,author_id,is_staff,body) values(p_ticket,auth.uid(),v_staff,v_body);
  end if;
  update public.support_tickets set status=coalesce(p_status,status), updated_at=clock_timestamp() where id=p_ticket;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.support_list(text), public.support_thread(uuid), public.support_create(text,text,text), public.support_respond(uuid,text,text) from public, anon;
grant execute on function public.support_list(text), public.support_thread(uuid), public.support_create(text,text,text), public.support_respond(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
