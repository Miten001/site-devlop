-- Run once after campaign URL normalizer and all campaign migrations.
-- Warning-only: matcher is available, but platform mismatch never rejects a campaign.
begin;
create or replace function public.campaign_platform_url_valid(p_platform text,p_url text)
returns boolean language plpgsql immutable set search_path=public as $$
declare v_url text:=public.ff_normalize_url(p_url); authority text; host text; domains text[];
begin
 if v_url is null then return false; end if;
 authority:=lower(substring(v_url from '^https?://([^/?#]+)'));
 if authority is null or authority ~ '[@%\\]' then return false; end if;
 if position(':' in authority)>0 and authority !~ ':[0-9]+$' then return false; end if;
 host:=regexp_replace(authority,':[0-9]+$','');
 if p_platform='website' then return true; end if;
 domains:=case p_platform
 when 'telegram' then array['t.me','telegram.me','telegram.dog']
 when 'youtube' then array['youtube.com','youtu.be','youtube-nocookie.com']
 when 'instagram' then array['instagram.com','instagr.am']
 when 'x' then array['x.com','twitter.com']
 when 'tiktok' then array['tiktok.com']
 when 'facebook' then array['facebook.com','fb.com','fb.me']
 when 'twitch' then array['twitch.tv']
 when 'pinterest' then array['pinterest.com','pin.it','pinterest.co.uk','pinterest.ca','pinterest.de','pinterest.fr','pinterest.es','pinterest.it','pinterest.jp','pinterest.com.au','pinterest.co.in']
 else array[]::text[] end;
 return exists(select 1 from unnest(domains) d where host=d or right(host,length(d)+1)='.'||d);
end $$;
create or replace function public.campaign_platform_link_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 -- Warning-only policy: browser and admin UI highlight mismatches; never block here.
 return new;
end $$;
drop trigger if exists campaign_platform_link_check on public.market_campaigns;
create trigger campaign_platform_link_check before insert or update of platform,url on public.market_campaigns for each row execute function public.campaign_platform_link_guard();
notify pgrst,'reload schema';
commit;
