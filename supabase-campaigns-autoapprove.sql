-- ============================================================
-- FlexFam — Campaign AUTO-APPROVE (owner review hatao)
--
-- Ab proof submit karte HI points worker ko mil jaate hain —
-- owner ke review ka intezaar nahi. Owner se payout turant
-- kat jaata hai. Sab ek hi transaction mein (atomic) —
-- double-pay kabhi nahi ho sakta.
--
-- RUN ORDER: supabase-campaigns.sql ke BAAD (campaigns_feed
-- chahiye). Safe to re-run.
-- Note: campaigns_review (owner review) install hi rehta hai —
-- purane pending proofs ke liye dashboard se ab bhi use ho sakta hai.
-- ============================================================

create or replace function public.campaigns_submit_proof(p_campaign text, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  c public.market_campaigns;
  s public.market_campaign_subs;
  bal public.balances;
  v_resubmit boolean := false;
begin
  select * into c from public.market_campaigns where id = p_campaign for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;
  if c.owner = v_user then raise exception 'You cannot complete your own campaign' using errcode = 'P0001'; end if;
  if c.active = false then raise exception 'This campaign is paused' using errcode = 'P0001'; end if;
  if p_proof is null or length(trim(p_proof)) < 3 then
    raise exception 'Add proof (link, username or screenshot URL)' using errcode = 'P0001';
  end if;

  select * into s from public.market_campaign_subs
   where campaign_id = p_campaign and worker = v_user;
  if found then
    if s.status <> 'rejected' then
      raise exception 'You already submitted this campaign' using errcode = 'P0001';
    end if;
    v_resubmit := true;
  end if;

  /* Pehle owner ke paas payout ke points hain? Nahi toh worker ka
     ek-submission chance waste na ho — pehle hi rok do. */
  insert into public.balances (user_id) values (c.owner) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = c.owner for update;
  if bal.points < c.payout then
    raise exception 'This campaign cannot pay out right now — please try again later.'
      using errcode = 'P0001';
  end if;

  /* Submission seedha APPROVED — owner review ki zaroorat nahi */
  if v_resubmit then
    update public.market_campaign_subs
       set proof = trim(p_proof), note = coalesce(trim(p_note), ''),
           status = 'approved', reason = '', at = now(), reviewed_at = now()
     where id = s.id;
  else
    insert into public.market_campaign_subs (campaign_id, worker, proof, note, status, reviewed_at)
    values (p_campaign, v_user, trim(p_proof), coalesce(trim(p_note), ''), 'approved', now());
  end if;

  /* Points transfer — owner se minus, worker ko plus */
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

  return public.campaigns_feed();
end;
$$;

revoke all on function public.campaigns_submit_proof(text, text, text) from public, anon;
grant execute on function public.campaigns_submit_proof(text, text, text) to authenticated;
