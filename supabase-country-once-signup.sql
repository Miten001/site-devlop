-- Run after supabase-member-countries.sql. Existing country rows already count as answered.
begin;
alter table public.member_countries alter column country_code drop not null;
create or replace function public.member_country_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user();
begin
 return jsonb_build_object('answered',exists(select 1 from public.member_countries where user_id=u),'country',(select country_code from public.member_countries where user_id=u));
end $$;
create or replace function public.member_country_set(p_country text)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid:=public.wallet_require_user();
begin
 -- A NULL country records a deliberate privacy choice, rather than deleting completion.
 insert into public.member_countries(user_id,country_code) values(u,upper(nullif(trim(p_country),'')))
 on conflict(user_id) do update set country_code=excluded.country_code;
end $$;
create or replace function public.member_country_on_signup()
returns trigger language plpgsql security definer set search_path=public as $$
declare country text:=upper(trim(coalesce(new.raw_user_meta_data->>'country_code','')));
begin
 if country='' then return new; end if;
 if country='PRIVATE' then country:=null; end if;
 begin
  insert into public.member_countries(user_id,country_code) values(new.id,country) on conflict(user_id) do nothing;
 exception when check_violation then
  -- Ignore invalid untrusted metadata. Country data must never break account creation.
  null;
 end;
 return new;
end $$;
drop trigger if exists member_country_signup on auth.users;
create trigger member_country_signup after insert on auth.users for each row execute function public.member_country_on_signup();
revoke all on function public.member_country_status(),public.member_country_set(text),public.member_country_on_signup() from public,anon;
revoke all on function public.member_country_on_signup() from authenticated;
grant execute on function public.member_country_status(),public.member_country_set(text) to authenticated;
notify pgrst,'reload schema';
commit;
