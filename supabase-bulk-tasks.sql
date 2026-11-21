-- One-time setup after all existing job/wallet migrations. Existing wallet functions are unchanged.
begin;
create table public.job_bulk_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null,
 published int not null,
 created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table public.job_bulk_requests enable row level security;
revoke all on public.job_bulk_requests from public,anon,authenticated;
create or replace function public.jobs_post_bulk(p_request uuid,p_tasks jsonb,p_expected_total numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user(); previous public.job_bulk_requests; cfg public.wallet_config;
 item jsonb; reward numeric; slots int; budget numeric; total numeric:=0; available numeric; n int;
begin
 if p_request is null or jsonb_typeof(p_tasks) is distinct from 'array' then raise exception 'Provide a request ID and task array'; end if;
 n:=jsonb_array_length(p_tasks);
 if n<1 or n>10 or octet_length(p_tasks::text)>200000 then raise exception 'A batch requires 1–10 tasks (maximum 200 KB)'; end if;
 -- Serialize concurrent retries and batches from the same member.
 perform pg_advisory_xact_lock(hashtextextended(u::text,918));
 select * into previous from public.job_bulk_requests where user_id=u and request_id=p_request;
 if found then
  if previous.payload<>p_tasks then raise exception 'Request ID already used with different tasks'; end if;
  return jsonb_build_object('ok',true,'published',previous.published,'replayed',true);
 end if;
 select * into cfg from public.wallet_config where id=1 for share;
 if not found then raise exception 'Wallet configuration unavailable'; end if;
 for item in select value from jsonb_array_elements(p_tasks) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid task entry'; end if;
  reward:=(item->>'reward')::numeric; slots:=(item->>'slots')::int;
  if reward is null or reward='NaN'::numeric or reward<cfg.min_job_reward or reward>1000000 or slots is null or slots<1 or slots>100000 then raise exception 'Invalid reward or worker slots'; end if;
  if length(coalesce(item->>'title',''))>120 or length(coalesce(item->>'description',''))>10000 or length(coalesce(item->>'proofNote',''))>10000 then raise exception 'Task text is too long'; end if;
  if coalesce(item->>'url','')<>'' and (item->>'url')!~* '^https?://[^[:space:]]+$' then raise exception 'Use an HTTP or HTTPS task URL'; end if;
  budget:=round(reward*slots,8);
  total:=total+budget+round(budget*cfg.platform_fee_pct/100.0,4);
 end loop;
 if p_expected_total is null or p_expected_total='NaN'::numeric or abs(total-p_expected_total)>0.00000001 then raise exception 'Price changed. Reload the current fee and preview again before publishing'; end if;
 insert into public.balances(user_id) values(u) on conflict(user_id) do nothing;
 select usdt into available from public.balances where user_id=u for update;
 if available<total then raise exception 'Insufficient balance for the full batch including fees'; end if;
 -- All calls share this transaction. An error rolls back every task and every debit.
 for item in select value from jsonb_array_elements(p_tasks) loop
  perform public.jobs_post(item->>'title',item->>'category',item->>'description',coalesce(item->>'url',''),coalesce(item->>'proofNote',''),(item->>'reward')::numeric,(item->>'slots')::int);
 end loop;
 insert into public.job_bulk_requests(user_id,request_id,payload,published) values(u,p_request,p_tasks,n);
 return jsonb_build_object('ok',true,'published',n,'charged',total,'replayed',false);
exception when others then
 -- PL/pgSQL rolls this entire block back before returning a definite failure.
 return jsonb_build_object('ok',false,'error',sqlerrm);
end $$;
revoke all on function public.jobs_post_bulk(uuid,jsonb,numeric) from public,anon;
grant execute on function public.jobs_post_bulk(uuid,jsonb,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
