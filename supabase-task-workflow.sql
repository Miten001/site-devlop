-- One-time migration after supabase-task-tools.sql and all job migrations.
begin;
create table public.task_corrections(sub_id uuid primary key references public.job_subs on delete cascade, instructions text not null check(length(instructions) between 10 and 2000), awaiting boolean not null default true, rounds int not null default 1, updated_at timestamptz not null default now());
create table public.task_reservations(job_id uuid references public.jobs on delete cascade, worker uuid references auth.users on delete cascade, expires_at timestamptz not null, primary key(job_id,worker));
create index on public.task_reservations(worker,expires_at);
create table public.worker_portfolios(user_id uuid primary key references auth.users on delete cascade, published boolean not null default false, headline text not null default '' check(length(headline)<=120), bio text not null default '' check(length(bio)<=1000), sample_url text not null default '' check(sample_url='' or (length(sample_url)<=1000 and sample_url ~ '^https://[^[:space:]]+$')));
alter table public.task_corrections enable row level security;
alter table public.task_reservations enable row level security;
alter table public.worker_portfolios enable row level security;
revoke all on public.task_corrections,public.task_reservations,public.worker_portfolios from public,anon,authenticated;

create function public.task_reserve(p_job uuid,p_release boolean default false)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); j public.jobs; expiry timestamptz; occupied int;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,712));
 select * into j from public.jobs where id=p_job for update;
 if not found then raise exception 'Task not found'; end if;
 if p_release then delete from public.task_reservations where job_id=p_job and worker=u; return null; end if;
 if j.owner=u or j.status<>'active' or j.escrow<j.reward then raise exception 'Task is not available'; end if;
 if exists(select 1 from public.job_subs where job_id=p_job and worker=u) then raise exception 'Already submitted'; end if;
 select expires_at into expiry from public.task_reservations where job_id=p_job and worker=u and expires_at>clock_timestamp();
 if found then return expiry; end if;
 if (select count(*) from public.task_reservations where worker=u and expires_at>clock_timestamp())>=2 then raise exception 'Release an active reservation first (maximum 2)'; end if;
 select (select count(*) from public.job_subs where job_id=p_job and status='pending')+(select count(*) from public.task_reservations where job_id=p_job and expires_at>clock_timestamp()) into occupied;
 if occupied>=least(j.slots-j.filled,floor(j.escrow/j.reward)::int) then raise exception 'No unreserved funded slots remain'; end if;
 expiry:=clock_timestamp()+interval '15 minutes';
 insert into public.task_reservations values(p_job,u,expiry) on conflict(job_id,worker) do update set expires_at=excluded.expires_at;
 return expiry;
end $$;

-- Enforce holds even for old clients; submission consumes a hold atomically.
create function public.task_submission_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare j public.jobs; occupied int;
begin
 if tg_op='INSERT' or (new.status='pending' and old.status<>'pending') then
  select * into j from public.jobs where id=new.job_id for update;
  if j.status<>'active' or j.owner=new.worker then raise exception 'Task unavailable'; end if;
  select (select count(*) from public.job_subs where job_id=new.job_id and status='pending')+(select count(*) from public.task_reservations where job_id=new.job_id and worker<>new.worker and expires_at>clock_timestamp()) into occupied;
  if occupied>=least(j.slots-j.filled,floor(j.escrow/j.reward)::int) then raise exception 'No available funded slots; other workers have reserved them'; end if;
  delete from public.task_reservations where job_id=new.job_id and worker=new.worker;
 elsif new.status='approved' and exists(select 1 from public.task_corrections where sub_id=new.id and awaiting) then
  raise exception 'Wait for corrected proof before approving';
 end if;
 return new;
end $$;
create trigger task_submission_capacity before insert or update of status on public.job_subs for each row execute function public.task_submission_guard();

create function public.task_correct(p_sub uuid,p_resubmit boolean,p_text text)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); s public.job_subs;
begin
 select * into s from public.job_subs where id=p_sub for update;
 if not found or s.status<>'pending' then raise exception 'Only pending submissions can be corrected'; end if;
 if p_resubmit then
  if s.worker<>u then raise exception 'Only the worker may resubmit'; end if;
  if length(trim(coalesce(p_text,''))) not between 6 and 1000000 then raise exception 'Add valid proof'; end if;
  if not exists(select 1 from public.task_corrections where sub_id=s.id and awaiting) then raise exception 'No correction requested'; end if;
  update public.job_subs set proof=trim(p_text) where id=s.id;
  update public.task_corrections set awaiting=false,updated_at=now() where sub_id=s.id;
 else
  if s.owner<>u then raise exception 'Only the task poster may request corrections'; end if;
  if length(trim(coalesce(p_text,''))) not between 10 and 2000 then raise exception 'Use 10–2000 characters'; end if;
  if exists(select 1 from public.task_corrections where sub_id=s.id and (awaiting or rounds>=3)) then raise exception 'Correction is outstanding or maximum 3 rounds reached'; end if;
  insert into public.task_corrections(sub_id,instructions) values(s.id,trim(p_text)) on conflict(sub_id) do update set instructions=excluded.instructions,awaiting=true,rounds=task_corrections.rounds+1,updated_at=now();
 end if;
end $$;

create function public.portfolio_save(p_published boolean,p_headline text,p_bio text,p_sample text)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.worker_portfolios values(public.wallet_require_user(),p_published,trim(p_headline),trim(p_bio),trim(p_sample)) on conflict(user_id) do update set published=excluded.published,headline=excluded.headline,bio=excluded.bio,sample_url=excluded.sample_url;
end $$;
create function public.portfolio_public(p_user uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('headline',p.headline,'bio',p.bio,'sample',p.sample_url,
 'approvedTasks',(select count(*) from public.job_subs s where s.worker=p.user_id and s.status='approved'),
 'rating',(select round(avg(stars),2) from public.task_ratings where target=p.user_id),
 'ratingCount',(select count(*) from public.task_ratings where target=p.user_id)) from public.worker_portfolios p where p.user_id=p_user and p.published;
$$;
create function public.task_workflow_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user();
begin
 return jsonb_build_object('userId',u,'portfolio',(select to_jsonb(p) from public.worker_portfolios p where user_id=u),
 'reservations',coalesce((select jsonb_agg(jsonb_build_object('job_id',r.job_id,'title',j.title,'expires_at',r.expires_at,'status',j.status)) from public.task_reservations r join public.jobs j on j.id=r.job_id where r.worker=u and r.expires_at>clock_timestamp()),'[]'::jsonb),
 'submissions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',j.title,'role',case when s.worker=u then 'Worker' else 'Poster' end,'status',s.status,'proof',s.proof,'instructions',c.instructions,'awaiting',coalesce(c.awaiting,false),'rounds',coalesce(c.rounds,0),'worker',s.worker)) from public.job_subs s join public.jobs j on j.id=s.job_id left join public.task_corrections c on c.sub_id=s.id where u in(s.worker,s.owner)),'[]'::jsonb));
end $$;
revoke all on function public.task_reserve(uuid,boolean),public.task_correct(uuid,boolean,text),public.portfolio_save(boolean,text,text,text),public.task_workflow_state(),public.portfolio_public(uuid),public.task_submission_guard() from public,anon;
grant execute on function public.task_reserve(uuid,boolean),public.task_correct(uuid,boolean,text),public.portfolio_save(boolean,text,text,text),public.task_workflow_state() to authenticated;
grant execute on function public.portfolio_public(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
