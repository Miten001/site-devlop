-- Run after wallet/task setup and supabase-member-countries.sql. Read-only, no daily prizes or wallet changes.
begin;
create index if not exists job_subs_daily_approved_idx on public.job_subs(reviewed_at,worker) where status='approved';
create or replace function public.daily_task_leaders()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'; result jsonb;
begin
 with totals as (
  select worker,sum(reward) as earned,count(*) as completed
  from public.job_subs
  where status='approved' and reviewed_at>=day_start and reviewed_at<day_start+interval '24 hours' and reward>0
  group by worker
 ), ranked as (
  select worker,earned,completed,row_number() over(order by earned desc,completed desc,worker asc) as rank from totals
 )
 select jsonb_build_object(
  'day',to_char(day_start at time zone 'UTC','YYYY-MM-DD'),
  'resetAt',day_start+interval '24 hours',
  'participants',(select count(*) from ranked),
  'myRank',(select rank from ranked where worker=u),
  'myEarned',coalesce((select earned from ranked where worker=u),0),
  'leaders',coalesce((select jsonb_agg(jsonb_build_object('rank',r.rank,'country',(select country_code from public.member_countries where user_id=r.worker),'member','FF-'||upper(substr(replace(r.worker::text,'-',''),1,8)),'earned',r.earned,'completed',r.completed,'isMe',r.worker=u) order by r.rank) from ranked r where r.rank<=50),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.daily_task_leaders() from public,anon;
grant execute on function public.daily_task_leaders() to authenticated;
notify pgrst,'reload schema';
commit;
