-- Run after mining setup; settle all previously earned rewards at the old rate.
begin;
lock table public.mining_accounts, public.mining_contracts, public.mining_config in access exclusive mode;
do $$ declare r record; current_rate numeric; begin
select usd_per_ghs_day into current_rate from public.mining_config where id=1;
if current_rate=0.000945 then return; end if;
if current_rate<>0.00105 or current_rate is null then raise exception 'Unexpected mining rate'; end if;
for r in select user_id from public.mining_accounts order by user_id loop
perform public.mining_accrue(r.user_id);
end loop;
update public.mining_config set usd_per_ghs_day=0.000945, updated_at=now() where id=1;
end $$;
alter table public.mining_config alter column usd_per_ghs_day set default 0.000945;
notify pgrst, 'reload schema';
commit;
