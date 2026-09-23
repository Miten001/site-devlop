-- ============================================================
-- FlexFam — Admin member detail (round 6)
-- Admin panel me kisi bhi member pe click karne par uski POORI
-- detail khulti hai — uske coins/USDT ke saath:
--   • wo kaunsi campaigns run kar raha hai (market_campaigns)
--   • usne kaunse tasks complete kiye (proofs / submissions)
-- admin.html ka member modal isko use karta hai.
--
-- RUN ORDER: supabase.sql ke BAAD (is_admin() wahan banta hai).
-- Ye SQL ek hi baar Supabase SQL Editor me run karo — safe to re-run.
-- ============================================================

create or replace function public.admin_member_detail(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  if p_user is null then
    raise exception 'Which member?' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    /* ye member kin campaigns ka owner hai (active + paused sab) */
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'active', c.active, 'actions', c.actions, 'spent', c.spent,
        'created', extract(epoch from c.created_at) * 1000
      ) order by c.created_at desc), '[]'::jsonb)
      from public.market_campaigns c
      where c.owner = p_user),

    /* is member ne kaunsi campaigns complete ki (proof bheje) */
    'subs', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'campaignId', s.campaign_id,
        'campaignTitle', c.title, 'platform', c.platform,
        'payout', c.payout, 'status', s.status, 'reason', s.reason,
        'proof', s.proof, 'note', s.note,
        'at', extract(epoch from s.at) * 1000,
        'reviewedAt', case when s.reviewed_at is null then 0
                           else extract(epoch from s.reviewed_at) * 1000 end
      ) order by s.at desc), '[]'::jsonb)
      from public.market_campaign_subs s
      join public.market_campaigns c on c.id = s.campaign_id
      where s.worker = p_user)
  );
end;
$$;

revoke all on function public.admin_member_detail(uuid) from public, anon;
grant execute on function public.admin_member_detail(uuid) to authenticated;
