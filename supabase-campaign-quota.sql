-- ============================================================
-- FlexFam · CAMPAIGN QUOTA — har platform par max 3 active
--
--   • Ek member ek social platform (Instagram, YouTube, Telegram…)
--     par maximum 3 ACTIVE campaigns rakh sakta hai
--   • 4th banane par turant error (Add Page par bhi pehle se dikhta hai)
--   • Pause/delete karke jagah khali hoti hai
--   • Resume (pause wapas on) par bhi limit check hoti hai
--
-- Safe to re-run. RUN ORDER: supabase-campaigns-limit.sql ke baad.
-- ============================================================

-- ------------------------------------------------------------
-- 1. campaigns_post — 3-per-platform quota guard ke saath
-- ------------------------------------------------------------
drop function if exists public.campaigns_post(text, text, text, text, text, numeric, int, int);

create or replace function public.campaigns_post(
  p_id text, p_platform text, p_action text, p_title text, p_url text,
  p_payout numeric, p_watch_secs int default 0, p_max_actions int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  bal public.balances;
  v_id text;
begin
  if p_title is null or length(trim(p_title)) < 3 then
    raise exception 'Title must be at least 3 characters' using errcode = 'P0001';
  end if;
  if p_payout is null or p_payout < 1 then
    raise exception 'Reward must be at least 1 point' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_platform), '') = '' or coalesce(trim(p_action), '') = '' then
    raise exception 'Pick a platform and engagement type' using errcode = 'P0001';
  end if;
  if p_url is null or p_url !~ '^https?://.+\..+' then
    raise exception 'Please enter a valid URL (https://...)' using errcode = 'P0001';
  end if;
  if p_watch_secs is null or p_watch_secs < 0 or p_watch_secs > 300 then
    raise exception 'Watch time must be between 0 and 300 seconds' using errcode = 'P0001';
  end if;
  if p_max_actions is null or p_max_actions < 0 or p_max_actions > 100000 then
    raise exception 'Engagement limit must be between 0 (no limit) and 100000' using errcode = 'P0001';
  end if;

  /* QUOTA: is platform par is member ki 3 active campaigns already hain? */
  if (select count(*) from public.market_campaigns
       where owner = v_user and platform = trim(p_platform) and active) >= 3 then
    raise exception 'Limit reached: only 3 active % campaigns at a time — pause or delete one first',
      coalesce(nullif(initcap(trim(p_platform)), ''), 'this platform')
      using errcode = 'P0001';
  end if;

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  if bal.points < p_payout then
    raise exception 'Not enough points — you have % on the server, need %', bal.points, p_payout
      using errcode = 'P0001';
  end if;

  v_id := coalesce(nullif(trim(p_id), ''), 'm' || (extract(epoch from now()) * 1000)::bigint);
  if exists (select 1 from public.market_campaigns where id = v_id) then
    v_id := v_id || '-' || substr(md5(random()::text), 1, 4);
  end if;

  insert into public.market_campaigns (id, owner, platform, action, title, url, payout, watch_secs, max_actions)
  values (v_id, v_user, trim(p_platform), trim(p_action), trim(p_title), trim(p_url),
          p_payout, greatest(0, coalesce(p_watch_secs, 0)), greatest(0, coalesce(p_max_actions, 0)));

  return public.campaigns_feed();
end;
$$;

-- ------------------------------------------------------------
-- 2. campaigns_toggle — resume par bhi quota lagti hai
--    (warna pause → naya banao → resume se 4th active ho jati)
-- ------------------------------------------------------------
create or replace function public.campaigns_toggle(p_campaign text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  c public.market_campaigns;
begin
  select * into c from public.market_campaigns
   where id = p_campaign and owner = v_user;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;

  if p_active and c.active = false then
    if (select count(*) from public.market_campaigns
         where owner = v_user and platform = c.platform and active) >= 3 then
      raise exception 'Limit reached: only 3 active % campaigns at a time — pause or delete one first',
        coalesce(nullif(initcap(c.platform), ''), 'this platform')
        using errcode = 'P0001';
    end if;
  end if;

  update public.market_campaigns set active = p_active
   where id = p_campaign and owner = v_user;
  if not found then raise exception 'Campaign not found' using errcode = 'P0001'; end if;

  return public.campaigns_feed();
end;
$$;

-- ------------------------------------------------------------
-- 3. Permissions
-- ------------------------------------------------------------
revoke all on function public.campaigns_post(text, text, text, text, text, numeric, int, int) from public, anon;
revoke all on function public.campaigns_toggle(text, boolean)                                from public, anon;

grant execute on function public.campaigns_post(text, text, text, text, text, numeric, int, int) to authenticated;
grant execute on function public.campaigns_toggle(text, boolean)                              to authenticated;
