-- Run LAST after campaign limit/referral migrations. All Earn Points campaigns
-- use a fixed server-enforced 7-second visit. Legacy proof parameters are ignored.
create table if not exists public.campaign_click_sessions (
  campaign_id text not null references public.market_campaigns(id) on delete cascade,
  worker uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  primary key(campaign_id,worker)
);
alter table public.campaign_click_sessions enable row level security;
revoke all on public.campaign_click_sessions from public, anon, authenticated;
create or replace function public.campaigns_start(p_campaign text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user(); c public.market_campaigns;
begin
  select * into c from public.market_campaigns where id=p_campaign for update;
  if not found then raise exception 'Campaign not found'; end if;
  if c.owner=v_user then raise exception 'You cannot complete your own campaign'; end if;
  if not c.active then raise exception 'This campaign is paused'; end if;
  if c.max_actions>0 and c.actions>=c.max_actions then raise exception 'This campaign reached its engagement limit'; end if;
  if exists(select 1 from public.market_campaign_subs where campaign_id=p_campaign and worker=v_user and status<>'rejected') then raise exception 'You already submitted this campaign'; end if;
  if not exists(select 1 from public.balances where user_id=c.owner and points>=c.payout) then raise exception 'This campaign cannot pay out right now'; end if;
  insert into public.campaign_click_sessions(campaign_id,worker,started_at) values(p_campaign,v_user,clock_timestamp())
    on conflict(campaign_id,worker) do update set started_at=excluded.started_at;
  return jsonb_build_object('waitSeconds',7);
end; $$;

create or replace function public.campaigns_submit_proof(p_campaign text, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  c public.market_campaigns;
  s public.market_campaign_subs;
  bal public.balances;
  v_resubmit boolean := false;
  v_started timestamptz;
begin
  select * into c from public.market_campaigns where id = p_campaign for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  if c.owner = v_user then raise exception 'You cannot complete your own campaign' using errcode = 'P0001'; end if;
  if c.active = false then raise exception 'This campaign is paused' using errcode = 'P0001'; end if;
  if c.max_actions > 0 and c.actions >= c.max_actions then
    raise exception 'This campaign reached its engagement limit' using errcode = 'P0001';
  end if;
  select started_at into v_started from public.campaign_click_sessions
   where campaign_id=p_campaign and worker=v_user for update;
  if not found or clock_timestamp() < v_started + interval '7 seconds' then
    raise exception 'Open this task and wait 7 seconds before claiming';
  end if;

  select * into s from public.market_campaign_subs
   where campaign_id = p_campaign and worker = v_user;
  if found then
    if s.status <> 'rejected' then
      raise exception 'You already submitted this campaign' using errcode = 'P0001';
    end if;
    v_resubmit := true;
  end if;

  insert into public.balances (user_id) values (c.owner) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = c.owner for update;
  if bal.points < c.payout then
    raise exception 'This campaign cannot pay out right now — please try again later.'
      using errcode = 'P0001';
  end if;

  if v_resubmit then
    update public.market_campaign_subs
       set proof = 'Completed 7-second visit (no proof required)', note = coalesce(trim(p_note), ''),
           status = 'approved', reason = '', at = now(), reviewed_at = now()
     where id = s.id;
  else
    insert into public.market_campaign_subs (campaign_id, worker, proof, note, status, reviewed_at)
    values (p_campaign, v_user, 'Completed 7-second visit (no proof required)', coalesce(trim(p_note), ''), 'approved', now());
  end if;

  update public.balances
     set points = points - c.payout, updated_at = now()
   where user_id = c.owner;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.balances
     set points = points + c.payout, updated_at = now()
   where user_id = v_user;

  update public.market_campaigns
     set actions = actions + 1, spent = round(spent + c.payout, 2)
   where id = c.id;

  delete from public.campaign_click_sessions where campaign_id=p_campaign and worker=v_user;
  perform public.referral_payout(v_user, c.payout, 'points',
    'Campaign "' || left(c.title, 40) || '" by ' || public.wallet_display_name(c.owner));
  return public.campaigns_feed();
end;
$$;
revoke all on function public.campaigns_start(text), public.campaigns_submit_proof(text,text,text) from public, anon;
grant execute on function public.campaigns_start(text), public.campaigns_submit_proof(text,text,text) to authenticated;
notify pgrst, 'reload schema';
