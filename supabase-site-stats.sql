-- ============================================================
-- FlexFam · DASHBOARD SITE OVERVIEW
-- Run this ENTIRE file once in the Supabase SQL Editor.
--
-- Requires supabase.sql. Campaign / Task Market counts become
-- available when their tables from supabase-campaigns.sql and
-- supabase-wallet.sql are installed. No existing data is changed.
-- Safe to re-run, including after installing those migrations.
--
-- Only signed-in members can read these six aggregate counts.
-- No emails, visitor IDs, proofs or other row-level data is exposed.
-- ============================================================

create or replace function public.site_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_running bigint;
  v_completed bigint;
begin
  -- The grant below already blocks anon; keep the reader boundary
  -- explicit inside this SECURITY DEFINER function as well.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Match the admin dashboard: running means live campaigns plus
  -- active Task Market listings, not pending worker submissions.
  -- Both sources must exist; a partial sum would be misleading.
  if to_regclass('public.market_campaigns') is not null
     and to_regclass('public.jobs') is not null then
    execute '
      select (select count(*) from public.market_campaigns where active)
           + (select count(*) from public.jobs where status = ''active'')'
      into v_running;
  end if;

  -- Completed means approved worker submissions from BOTH markets.
  -- Pending and rejected proofs are not completed tasks.
  if to_regclass('public.market_campaign_subs') is not null
     and to_regclass('public.job_subs') is not null then
    execute '
      select (select count(*) from public.market_campaign_subs where status = ''approved'')
           + (select count(*) from public.job_subs where status = ''approved'')'
      into v_completed;
  end if;

  return jsonb_build_object(
    'visitors_today', (
      select count(distinct nullif(trim(e.vid), ''))
      from public.events e
      where e.day = current_date
    ),
    'registered_today', (
      select count(*) from public.profiles p
      where p.created_at >= current_date::timestamptz
        and p.created_at < (current_date + 1)::timestamptz
    ),
    'total_views', (
      select count(*) from public.events e where e.type = 'page_view'
    ),
    'total_registered', (select count(*) from public.profiles),
    'running_tasks', v_running,
    'completed_tasks', v_completed
  );
end;
$$;

revoke all on function public.site_stats() from public, anon, authenticated;
grant execute on function public.site_stats() to authenticated;

-- Keep the existing two-counter RPC for older clients. The dashboard
-- uses it as a daily-only fallback until this migration is installed.
