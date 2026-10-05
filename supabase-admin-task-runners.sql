-- ============================================================
-- FlexFam · ADMIN TASK RUNNERS LIST
-- chalane ka tarika: Supabase Dashboard → SQL Editor → paste → Run
-- (correct project: ekrqtlbwaotgdtrpqhrc)
--
-- kya deta hai (sirf admin — FF admin email ke liye):
--   admin_task_runners() → har member ka task scorecard, EK call me:
--     • kitne campaigns chala raha hai (active / paused / total)
--     • kitne tasks complete kiye (approved) + kitne proofs
--       review ke liye pending hain
--     • total completions (actions) aur coins spent
--   admin.html ka naya "⚡ Tasks" section aur Members table ka
--   "Tasks running" column isi function ko use karte hain —
--   bina kisi member par click kiye counts bahar se dikh jaate hain.
--
-- RUN ORDER: supabase.sql ke BAAD (is_admin() wahan banta hai).
-- Safe to re-run (idempotent hai).
-- ============================================================

create or replace function public.admin_task_runners()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    /* site-wide totals — Tasks section ke mini-stats */
    'totalCamps',  (select count(*) from public.market_campaigns),
    'activeCamps', (select count(*) from public.market_campaigns where active),
    'pausedCamps', (select count(*) from public.market_campaigns where not active),

    /* har wo member jo campaigns chalata hai YA tasks karta hai */
    'runners', coalesce((
      select jsonb_agg(t order by (t->>'active')::int desc, (t->>'totalCamps')::int desc, t->>'name)
      from (
        select jsonb_build_object(
                 'userId',       p.id,
                 'name',         coalesce(nullif(trim(p.display_name), ''), 'Member'),
                 'email',        coalesce(p.email, ''),
                 'totalCamps',   count(c.id),
                 'active',       count(c.id) filter (where c.active),
                 'paused',       count(c.id) filter (where not c.active),
                 'actions',      coalesce(sum(c.actions), 0),
                 'spent',        coalesce(sum(c.spent), 0),
                 'tasksDone',    (select count(*) from public.market_campaign_subs s
                                   where s.worker = p.id and s.status = 'approved'),
                 'tasksPending', (select count(*) from public.market_campaign_subs s
                                   where s.worker = p.id and s.status = 'pending')
               ) as t
        from public.profiles p
        left join public.market_campaigns c on c.owner = p.id
        where exists (select 1 from public.market_campaigns c2 where c2.owner = p.id)
           or exists (select 1 from public.market_campaign_subs s2 where s2.worker = p.id)
        group by p.id, p.display_name, p.email
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------
-- Permissions — browser/anon ko nahi, sirf logged-in members
-- (andar is_admin() guard hai, isliye non-admin ko error milega)
-- ------------------------------------------------------------
revoke all on function public.admin_task_runners() from public, anon;
grant execute on function public.admin_task_runners() to authenticated;
