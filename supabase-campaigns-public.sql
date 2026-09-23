-- FlexFam — public campaign listing (demo/guest users ko bhi campaigns dikhe)
--
-- KYA HAI YE: Ab tak campaigns sirf un members ko dikhti the jinke paas
-- real login session tha. Demo account / offline mode wale members ko
-- Earn page par kuch nahi dikhta tha. Ye function campaigns ki LIST
-- publicly (bina login ke) de deta hai — jaise bonus missions sabko
-- dikhte hain. Complete karne ke liye ab bhi real account chahiye.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> is POORE
-- file ko paste karo -> Run. "Success" dikhna chahiye.
-- Depends on: supabase-campaigns.sql. Safe to re-run (idempotent).

create or replace function public.campaigns_public_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(c order by c ->> 'created' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', c.id, 'platform', c.platform, 'action', c.action,
        'user', public.wallet_display_name(c.owner),
        'title', c.title, 'url', c.url, 'payout', c.payout,
        'mine', false, 'active', c.active,
        'created', extract(epoch from c.created_at) * 1000) as c
      from public.market_campaigns c
      where c.active
    ) o)
  );
end;
$$;

revoke all on function public.campaigns_public_feed() from public;
grant execute on function public.campaigns_public_feed() to anon, authenticated;
