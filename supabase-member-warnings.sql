-- FlexFam member warnings (#20). Run after supabase.sql; community SQL is optional.
create table if not exists public.member_warnings(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 reason text not null, severity text not null default 'warning' check(severity in('warning','final')),
 acknowledged boolean not null default false, acknowledged_at timestamptz, created_at timestamptz not null default now()
);
alter table public.member_warnings enable row level security;

create or replace function public.admin_warn_member(p_email text,p_reason text,p_severity text default 'warning')
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid; sev text:=case when p_severity='final' then 'final' else 'warning' end;
begin
 if not public.is_admin() then raise exception 'Admins only'; end if;
 if coalesce(trim(p_reason),'')='' then raise exception 'Warning ka reason likhna zaroori hai'; end if;
 select id into u from public.profiles where lower(email)=lower(trim(p_email)) limit 1;
 if u is null then raise exception 'No account found for %',p_email; end if;
 insert into public.member_warnings(user_id,reason,severity) values(u,trim(p_reason),sev);
 begin perform public.messages_admin_send(lower(trim(p_email)),case when sev='final' then '⚠️ FINAL WARNING from FlexFam admin' else '⚠️ Warning from FlexFam admin' end,trim(p_reason)); exception when others then null; end;
 return public.admin_member_warnings(u);
end; $$;
create or replace function public.admin_member_warnings(p_user uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Admins only'; end if;
 return jsonb_build_object('warnings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reason',reason,'severity',severity,'acknowledged',acknowledged,'at',extract(epoch from created_at)*1000) order by created_at desc) from public.member_warnings where user_id=p_user),'[]'::jsonb));
end; $$;
create or replace function public.member_warnings()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Please log in'; end if;
 return jsonb_build_object('warnings',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reason',reason,'severity',severity,'acknowledged',acknowledged,'at',extract(epoch from created_at)*1000) order by created_at desc) from public.member_warnings where user_id=auth.uid()),'[]'::jsonb));
end; $$;
create or replace function public.member_warning_ack(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Please log in'; end if;
 update public.member_warnings set acknowledged=true,acknowledged_at=now() where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Warning not found'; end if;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.admin_warn_member(text,text,text) from public,anon;
revoke all on function public.admin_member_warnings(uuid) from public,anon;
revoke all on function public.member_warnings() from public,anon;
revoke all on function public.member_warning_ack(uuid) from public,anon;
grant execute on function public.admin_warn_member(text,text,text) to authenticated;
grant execute on function public.admin_member_warnings(uuid) to authenticated;
grant execute on function public.member_warnings() to authenticated;
grant execute on function public.member_warning_ack(uuid) to authenticated;
