-- ============================================================
-- FlexFam · ADMIN CAMPAIGN MANAGER
-- chalane ka tarika: Supabase Dashboard → SQL Editor → paste → Run
-- (correct project: ekrqtlbwaotgdtrpqhrc)
--
-- kya deta hai (sirf admin — FF admin email ke liye):
--   1. admin_campaigns_list()      → SAARI campaigns + kisne banayi
--                                    (owner name + email), stats, status
--   2. admin_campaigns_update(...)  → koi bhi campaign EDIT karo
--                                    (title, link, platform, action,
--                                     payout, watch time, pause/resume,
--                                     engagement limit)
--   3. admin_campaigns_delete(...)  → koi bhi campaign DELETE karo
--
-- baaps: is_admin() supabase.sql me pehle se installed hai —
-- ye file standalone chal sakti hai (watch column apne aap add ho
-- jata hai agar missing ho).
-- ============================================================

-- 0. safety: watch column (agar supabase-campaigns-watch.sql nahi chala)
alter table public.market_campaigns
  add column if not exists watch_secs int not null default 0;

-- ------------------------------------------------------------
-- 1. LIST — saari campaigns + owner ki identity + stats
-- ------------------------------------------------------------
create or replace function public.admin_campaigns_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from public.market_campaigns),
    'campaigns', coalesce((
      select jsonb_agg(t order by t->>'created' desc)
      from (
        select jsonb_build_object(
                 'id',       c.id,
                 'title',    c.title,
                 'url',      c.url,
                 'platform', c.platform,
                 'action',   c.action,
                 'payout',   c.payout,
                 'watchSecs', c.watch_secs,
                 'maxActions', c.max_actions,
                 'active',   c.active,
                 'actions',  c.actions,
                 'spent',    c.spent,
                 'created',  c.created_at,
                 'ownerId',  c.owner,
                 'ownerName', coalesce(nullif(trim(p.display_name), ''), 'Member'),
                 'ownerEmail', coalesce(p.email, '')
               ) as t
        from public.market_campaigns c
        left join public.profiles p on p.id = c.owner
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- 2. UPDATE — admin kisi bhi campaign ko edit kar sakta hai
--    (payout 1–100, watch 0–300 s, 0 = proof mode)
-- ------------------------------------------------------------
drop function if exists public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean);

create or replace function public.admin_campaigns_update(
  p_campaign   text,
  p_title      text,
  p_url        text,
  p_platform   text,
  p_action     text,
  p_payout     numeric,
  p_watch_secs int default 0,
  p_active     boolean default true,
  p_max_actions int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required' using errcode = 'P0001';
  end if;
  if p_payout is null or p_payout < 1 or p_payout > 100 then
    raise exception 'Payout must be between 1 and 100' using errcode = 'P0001';
  end if;
  if p_watch_secs is null or p_watch_secs < 0 or p_watch_secs > 300 then
    raise exception 'Watch time must be between 0 and 300 seconds' using errcode = 'P0001';
  end if;
  if p_max_actions is null or p_max_actions < 0 or p_max_actions > 100000 then
    raise exception 'Engagement limit must be between 0 (no limit) and 100000' using errcode = 'P0001';
  end if;

  update public.market_campaigns set
    title      = trim(p_title),
    url        = coalesce(nullif(trim(p_url), ''), ''),
    platform   = coalesce(nullif(trim(p_platform), ''), platform),
    action     = coalesce(nullif(trim(p_action), ''), action),
    payout     = round(p_payout::numeric, 1),
    watch_secs = p_watch_secs,
    active     = coalesce(p_active, active),
    max_actions = greatest(0, coalesce(p_max_actions, 0))
  where id = p_campaign;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0001';
  end if;

  return public.admin_campaigns_list();
end;
$$;

-- ------------------------------------------------------------
-- 3. DELETE — admin kisi bhi campaign ko hata sakta hai
--    (uske submissions/proofs bhi cascade delete ho jaate hain)
-- ------------------------------------------------------------
create or replace function public.admin_campaigns_delete(p_campaign text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  delete from public.market_campaigns where id = p_campaign;

  if not found then
    raise exception 'Campaign not found' using errcode = 'P0001';
  end if;

  return public.admin_campaigns_list();
end;
$$;

-- ------------------------------------------------------------
-- 4. Permissions — browser/anon ko nahi, sirf logged-in members
--    (andar is_admin() guard hai, isliye non-admin ko error milega)
-- ------------------------------------------------------------
revoke all on function public.admin_campaigns_list()                                          from public, anon;
revoke all on function public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean, int) from public, anon;
revoke all on function public.admin_campaigns_delete(text)                                     from public, anon;

grant execute on function public.admin_campaigns_list()                                          to authenticated;
grant execute on function public.admin_campaigns_update(text, text, text, text, text, numeric, int, boolean, int) to authenticated;
grant execute on function public.admin_campaigns_delete(text)                                     to authenticated;
