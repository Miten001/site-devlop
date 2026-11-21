-- Optional self-reported country sharing; no IP/geolocation inference.
begin;
create table if not exists public.member_countries (
 user_id uuid primary key references auth.users(id) on delete cascade,
 country_code text not null check (country_code in ('AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'))
);
alter table public.member_countries enable row level security;
revoke all on public.member_countries from public,anon,authenticated;
create or replace function public.member_country_get()
returns text language sql stable security definer set search_path=public as $$
 select country_code from public.member_countries where user_id=auth.uid();
$$;
create or replace function public.member_country_set(p_country text)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user();
begin
 if nullif(trim(p_country),'') is null then
  delete from public.member_countries where user_id=u;
 else
  insert into public.member_countries values(u,upper(trim(p_country))) on conflict(user_id) do update set country_code=excluded.country_code;
 end if;
end $$;
revoke all on function public.member_country_get(),public.member_country_set(text) from public,anon;
grant execute on function public.member_country_get(),public.member_country_set(text) to authenticated;
notify pgrst,'reload schema';
commit;
