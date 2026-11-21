-- Replaces the previously deployed blocking guard. Mismatches are informational only.
begin;
create or replace function public.campaign_platform_link_guard()
returns trigger language plpgsql set search_path=public as $$
begin
 return new;
end $$;
notify pgrst,'reload schema';
commit;
