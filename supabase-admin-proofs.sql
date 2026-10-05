-- FlexFam admin proof review (#19)
-- Run after supabase.sql, supabase-campaigns.sql and supabase-wallet.sql.
create or replace function public.admin_proofs_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'campSubs', coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'campaignId',s.campaign_id,'campaignTitle',c.title,'platform',c.platform,
      'payout',c.payout,'ownerName',coalesce(o.display_name,'Member'),'ownerEmail',coalesce(o.email,''),
      'workerId',s.worker,'workerName',coalesce(w.display_name,'Member'),'workerEmail',coalesce(w.email,''),
      'proof',s.proof,'note',s.note,'status',s.status,'reason',s.reason,
      'at',extract(epoch from s.at)*1000,'reviewedAt',coalesce(extract(epoch from s.reviewed_at)*1000,0)
    ) order by s.at desc) from public.market_campaign_subs s join public.market_campaigns c on c.id=s.campaign_id
      left join public.profiles w on w.id=s.worker left join public.profiles o on o.id=c.owner limit 300),'[]'::jsonb),
    'jobSubs', coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'jobId',s.job_id,'jobTitle',j.title,'reward',s.reward,
      'ownerName',coalesce(o.display_name,'Member'),'ownerEmail',coalesce(o.email,''),
      'workerId',s.worker,'workerName',coalesce(w.display_name,'Member'),'workerEmail',coalesce(w.email,''),
      'proof',s.proof,'note',s.note,'status',s.status,'reason',s.reason,
      'at',extract(epoch from s.at)*1000,'reviewedAt',coalesce(extract(epoch from s.reviewed_at)*1000,0)
    ) order by s.at desc) from public.job_subs s join public.jobs j on j.id=s.job_id
      left join public.profiles w on w.id=s.worker left join public.profiles o on o.id=j.owner limit 300),'[]'::jsonb)
  );
end; $$;

create or replace function public.admin_proofs_review(p_sub uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.market_campaign_subs; c public.market_campaigns;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into s from public.market_campaign_subs where id=p_sub for update;
  if not found or s.status <> 'pending' then raise exception 'Submission not found or already reviewed'; end if;
  select * into c from public.market_campaigns where id=s.campaign_id for update;
  update public.market_campaign_subs set status=case when p_approve then 'approved' else 'rejected' end,
    reason=coalesce(p_reason,''), reviewed_at=now() where id=p_sub;
  if p_approve then
    insert into public.balances(user_id) values(c.owner) on conflict(user_id) do nothing;
    update public.balances set points=points-c.payout,updated_at=now() where user_id=c.owner and points>=c.payout;
    if not found then raise exception 'Owner does not have enough points to pay this reward'; end if;
    insert into public.balances(user_id) values(s.worker) on conflict(user_id) do nothing;
    update public.balances set points=points+c.payout,updated_at=now() where user_id=s.worker;
    update public.market_campaigns set actions=actions+1,spent=round(spent+c.payout,2) where id=c.id;
  end if;
  return public.admin_proofs_list();
end; $$;
revoke all on function public.admin_proofs_list() from public,anon;
revoke all on function public.admin_proofs_review(uuid,boolean,text) from public,anon;
grant execute on function public.admin_proofs_list() to authenticated;
grant execute on function public.admin_proofs_review(uuid,boolean,text) to authenticated;
