-- Run after wallet/job migrations. No wallet functions are replaced.
begin;
create table public.task_saves (user_id uuid references auth.users on delete cascade, job_id uuid references public.jobs on delete cascade, primary key(user_id,job_id));
create table public.task_ratings (sub_id uuid references public.job_subs on delete cascade, author uuid references auth.users on delete cascade, target uuid references auth.users on delete cascade not null, stars int not null check(stars between 1 and 5), primary key(sub_id,author));
create table public.task_disputes (sub_id uuid primary key references public.job_subs on delete cascade, worker uuid not null references auth.users, reason text not null check(length(reason) between 10 and 2000), status text not null default 'open' check(status in ('open','upheld','reopened')), decision text not null default '', created_at timestamptz not null default now());
create table public.task_reports (job_id uuid references public.jobs on delete cascade, reporter uuid references auth.users on delete cascade, reason text not null check(length(reason) between 10 and 2000), status text not null default 'open' check(status in ('open','resolved')), primary key(job_id,reporter));
alter table public.task_saves enable row level security;
alter table public.task_ratings enable row level security;
alter table public.task_disputes enable row level security;
alter table public.task_reports enable row level security;
revoke all on public.task_saves,public.task_ratings,public.task_disputes,public.task_reports from anon,authenticated;

create function public.task_tools_action(p_action text, p_id uuid, p_text text default '', p_stars int default null)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); s public.job_subs; j public.jobs; d public.task_disputes;
begin
 if p_action='save' then
  if not exists(select 1 from public.jobs where id=p_id) then raise exception 'Task not found'; end if;
  insert into public.task_saves values(u,p_id) on conflict do nothing;
 elsif p_action='unsave' then delete from public.task_saves where user_id=u and job_id=p_id;
 elsif p_action='report' then
  if length(trim(p_text)) not between 10 and 2000 then raise exception 'Explain the report in 10–2000 characters'; end if;
  insert into public.task_reports(job_id,reporter,reason) values(p_id,u,trim(p_text)) on conflict do nothing;
 elsif p_action='resolve_report' then
  if not coalesce(public.is_admin(),false) then raise exception 'Admins only'; end if;
  update public.task_reports set status='resolved' where job_id=p_id;
 elsif p_action in ('rate','dispute','uphold','reopen') then
  select * into s from public.job_subs where id=p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if p_action='rate' then
   if s.status<>'approved' or u not in(s.worker,s.owner) or s.worker=s.owner then raise exception 'Only participants in an approved task may rate'; end if;
   insert into public.task_ratings values(s.id,u,case when u=s.worker then s.owner else s.worker end,p_stars);
  elsif p_action='dispute' then
   if u<>s.worker or s.status<>'rejected' then raise exception 'Only the worker may appeal a rejected submission'; end if;
   insert into public.task_disputes(sub_id,worker,reason) values(s.id,u,trim(p_text));
  else
   if not coalesce(public.is_admin(),false) then raise exception 'Admins only'; end if;
   if length(trim(p_text)) not between 10 and 2000 then raise exception 'Decision must be 10–2000 characters'; end if;
   select * into d from public.task_disputes where sub_id=s.id for update;
   if not found or d.status<>'open' or s.status<>'rejected' then raise exception 'Dispute is not open'; end if;
   if p_action='reopen' then
    select * into j from public.jobs where id=s.job_id for update;
    if j.status<>'active' or j.escrow<j.reward or j.filled>=j.slots then raise exception 'Cannot reopen: task has no funded slots. Use Support for manual resolution.'; end if;
    update public.job_subs set status='pending',reason=trim(p_text),reviewed_at=null where id=s.id;
   end if;
   update public.task_disputes set status=case when p_action='reopen' then 'reopened' else 'upheld' end,decision=trim(p_text) where sub_id=s.id;
  end if;
 else raise exception 'Unknown action'; end if;
end $$;

create function public.task_tools_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); staff boolean:=coalesce(public.is_admin(),false);
begin
return jsonb_build_object('isAdmin',staff,
 'saved',coalesce((select jsonb_agg(to_jsonb(j)) from public.task_saves b join public.jobs j on j.id=b.job_id where b.user_id=u),'[]'::jsonb),
 'ratings',coalesce((select jsonb_agg(r) from (select target,round(avg(stars),2) as average,count(*) as count from public.task_ratings group by target) r),'[]'::jsonb),
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',j.title,'status',s.status,'role',case when s.worker=u then 'Worker' else 'Poster' end,'rated',exists(select 1 from public.task_ratings r where r.sub_id=s.id and r.author=u),'target',case when s.worker=u then s.owner else s.worker end)) from public.job_subs s join public.jobs j on j.id=s.job_id where u in(s.worker,s.owner)),'[]'::jsonb),
 'disputes',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('title',j.title,'proof',s.proof,'rejection',s.reason)) from public.task_disputes d join public.job_subs s on s.id=d.sub_id join public.jobs j on j.id=s.job_id where staff or u in(s.worker,s.owner)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('title',j.title)) from public.task_reports r join public.jobs j on j.id=r.job_id where staff or r.reporter=u),'[]'::jsonb),
 'performance',coalesce((select jsonb_agg(r) from (select j.id,j.title,j.status,j.reward,j.slots,j.filled,j.escrow,j.fee,
 (select count(*) from public.job_subs s where s.job_id=j.id and s.status='pending') as pending,
 (select count(*) from public.job_subs s where s.job_id=j.id and s.status='rejected') as rejected,
 (select coalesce(sum(s.reward),0) from public.job_subs s where s.job_id=j.id and s.status='approved') as paid
 from public.jobs j where j.owner=u) r),'[]'::jsonb));
end $$;
revoke all on function public.task_tools_action(text,uuid,text,int),public.task_tools_state() from public,anon;
grant execute on function public.task_tools_action(text,uuid,text,int),public.task_tools_state() to authenticated;
-- Reject explicit credential-harvesting instructions at the database boundary.
create function public.task_safety_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 if concat_ws(' ',new.title,new.description,new.proof_note) ~* '(send|share|provide|submit|give).{0,40}(password|otp|recovery code|backup code)' then
  raise exception 'Tasks must not request passwords, OTPs or recovery codes';
 end if;
 return new;
end $$;
create trigger task_safety_before_post before insert or update of title,description,proof_note on public.jobs for each row execute function public.task_safety_guard();
notify pgrst,'reload schema';
commit;
