-- ============================================================
-- FlexFam · URL FIX — "Please enter a valid URL (https://...)"
--
--   Problem: server ka URL check bahut strict tha. Member agar
--   "t.me/mychannel", "www.youtube.com/@me" ya mobile se copy kiya
--   link (extra space / zero-width char / <> brackets) deta tha to
--   campaign reject ho jaati thi.
--
--   Fix: public.ff_normalize_url() — link ko saaf karke pura
--   https:// URL banata hai, aur sirf genuinely galat link par NULL
--   deta hai. campaigns_post ab normalized URL hi save karta hai.
--
-- Safe to re-run. RUN ORDER: supabase-campaign-quota.sql ke baad
-- (referral-pyramid ke saath koi conflict nahi).
-- ============================================================

-- ------------------------------------------------------------
-- 1. URL normalizer (browser ke FF.normalizeUrl jaisa hi)
-- ------------------------------------------------------------
create or replace function public.ff_normalize_url(p_url text)
returns text language plpgsql immutable as $$
declare
  s    text;
  host text;
begin
  if p_url is null then return null; end if;

  s := p_url;
  -- zero-width chars + non-breaking space ko normal space bana do
  s := translate(s, chr(8203) || chr(8204) || chr(8205) || chr(65279) || chr(160), '     ');
  -- aage/peeche ke spaces, brackets, quotes hatao
  s := btrim(s, ' ' || chr(9) || chr(10) || chr(13) || '<>()[]"''');
  -- link ke baad ka extra text ignore karo ("t.me/x mera channel")
  s := regexp_replace(s, '\s.*$', '');
  -- trailing punctuation ("https://x.com/page." → "…/page")
  s := regexp_replace(s, '[.,;]+$', '');
  s := regexp_replace(s, '^@+', '');
  if s = '' then return null; end if;

  if s ~* '^https?://' then
    s := regexp_replace(s, '^https:/+', 'https://', 'i');
    s := regexp_replace(s, '^http:/+',  'http://',  'i');
  elsif s ~* '^https?:' then
    -- "https:/t.me/x" ya "https:t.me/x"
    s := 'https://' || regexp_replace(s, '^https?:/*', '', 'i');
  elsif s ~* '^[a-z][a-z0-9+.-]*:' then
    return null;                                  -- mailto:, javascript:, tg: …
  else
    s := 'https://' || regexp_replace(s, '^/+', '');
  end if;

  -- host nikaalo: scheme ke baad pehla segment, userinfo/port/query hata ke
  host := lower(regexp_replace(s, '^https?://', '', 'i'));
  host := split_part(host, '/', 1);
  host := split_part(host, '?', 1);
  host := split_part(host, '#', 1);
  if position('@' in host) > 0 then
    host := split_part(host, '@', 2);
  end if;
  host := split_part(host, ':', 1);

  -- kam se kam ek dot + valid TLD (localhost / raw IP allowed nahi)
  if host !~ '^([a-z0-9-]+\.)+(xn--[a-z0-9-]{2,}|[a-z]{2,})$' then
    return null;
  end if;

  return s;
end;
$$;

-- ------------------------------------------------------------
-- 2. campaigns_post — normalized URL ke saath (baaki logic same:
--    title / payout / watch / limit / 3-per-platform quota)
-- ------------------------------------------------------------
create or replace function public.campaigns_post(
  p_id text, p_platform text, p_action text, p_title text, p_url text,
  p_payout numeric, p_watch_secs int default 0, p_max_actions int default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  bal public.balances;
  v_id text;
  v_url text;
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

  v_url := public.ff_normalize_url(p_url);
  if v_url is null then
    raise exception 'Please enter a valid page link — e.g. t.me/yourchannel or https://youtube.com/@you'
      using errcode = 'P0001';
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
  values (v_id, v_user, trim(p_platform), trim(p_action), trim(p_title), v_url,
          p_payout, greatest(0, coalesce(p_watch_secs, 0)), greatest(0, coalesce(p_max_actions, 0)));

  return public.campaigns_feed();
end;
$$;

-- ------------------------------------------------------------
-- 3. Permissions
-- ------------------------------------------------------------
revoke all on function public.campaigns_post(text, text, text, text, text, numeric, int, int) from public, anon;
grant execute on function public.campaigns_post(text, text, text, text, text, numeric, int, int) to authenticated;
grant execute on function public.ff_normalize_url(text) to authenticated, anon;
