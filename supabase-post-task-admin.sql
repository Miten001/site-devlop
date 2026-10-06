-- ============================================================
-- FlexFam · POST TASK QUOTA + ADMIN TASK MANAGER   (#21)
--
--   1. Ek member ek CATEGORY (type) par maximum 3 ACTIVE/PAUSED
--      tasks post kar sakta hai. 4th par turant error.
--   2. Admin panel ab posted tasks ko EDIT / APPROVE (resume) /
--      PAUSE / DELETE kar sakta hai (escrow safe refund ke saath).
--   3. Task Market feed me jyada reward wali task pehle.
--
-- Safe to re-run (idempotent).
-- RUN ORDER: supabase-wallet.sql (#3) ke baad.
-- ============================================================

-- ------------------------------------------------------------
-- 0. 'paused' status allow karo (admin pause/approve ke liye)
-- ------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('active', 'paused', 'completed', 'cancelled'));

-- ------------------------------------------------------------
-- 1. jobs_post — per-category quota (max 3 ek sath)
-- ------------------------------------------------------------
create or replace function public.jobs_post(
  p_title text, p_category text, p_description text, p_url text,
  p_proof_note text, p_reward numeric, p_slots int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_cat text := coalesce(nullif(trim(p_category), ''), 'other');
  v_catname text;
  v_live int;
  v_budget numeric; v_fee numeric; v_total numeric;
begin
  select * into cfg from public.wallet_config where id = 1;

  if p_title is null or length(trim(p_title)) < 6 then
    raise exception 'Task title must be at least 6 characters' using errcode = 'P0001';
  end if;
  if p_description is null or length(trim(p_description)) < 20 then
    raise exception 'Describe the task in at least 20 characters' using errcode = 'P0001';
  end if;
  if p_reward is null or p_reward < cfg.min_job_reward then
    raise exception 'Minimum reward is $% per worker', cfg.min_job_reward using errcode = 'P0001';
  end if;
  if p_slots is null or p_slots < 1 then
    raise exception 'At least 1 worker slot is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.job_categories where key = v_cat) then
    raise exception 'Unknown task category' using errcode = 'P0001';
  end if;

  /* QUOTA — ek type (category) par 3 se jyada task ek sath nahi */
  select count(*) into v_live
    from public.jobs
   where owner = v_user and category = v_cat
     and status in ('active', 'paused');

  if v_live >= 3 then
    select name into v_catname from public.job_categories where key = v_cat;
    raise exception
      'Limit reached: only 3 live % tasks at a time — cancel or finish one first',
      coalesce(v_catname, v_cat) using errcode = 'P0001';
  end if;

  v_budget := round(p_reward * p_slots, 8);
  v_fee    := round(v_budget * cfg.platform_fee_pct / 100.0, 4);
  v_total  := round(v_budget + v_fee, 8);

  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  if bal.usdt < v_total then
    raise exception 'Need $% USDT in your wallet (incl. % fee) — you have $%',
      round(v_total, 2), public.wallet_pct_label(cfg.platform_fee_pct),
      round(bal.usdt, 2) using errcode = 'P0001';
  end if;

  update public.balances
     set usdt = round(usdt - v_total, 8), locked = round(locked + v_budget, 8), updated_at = now()
   where user_id = v_user;

  insert into public.jobs (owner, title, category, description, url, proof_note, reward, slots, escrow, fee)
  values (v_user, trim(p_title), v_cat, trim(p_description),
          coalesce(trim(p_url), ''),
          coalesce(nullif(trim(p_proof_note), ''), 'Screenshot / proof link of the completed action'),
          p_reward, p_slots, v_budget, v_fee);

  perform public.wallet_tx(v_user, 'escrow', -v_total,
    'Escrow for task "' || trim(p_title) || '" (' || p_slots || ' slots + ' || cfg.platform_fee_pct || '% fee)',
    'completed', null, null);

  return public.jobs_feed();
end;
$$;

-- ------------------------------------------------------------
-- 2. jobs_quota — Post a Task page par live counter
-- ------------------------------------------------------------
create or replace function public.jobs_quota()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    'max', 3,
    'byCategory', coalesce((
      select jsonb_object_agg(cat, n) from (
        select category as cat, count(*) as n
          from public.jobs
         where owner = v_user and status in ('active', 'paused')
         group by category) q
    ), '{}'::jsonb));
end;
$$;

-- ------------------------------------------------------------
-- 3. jobs_feed — open list me jyada reward wali task pehle
--    (baki sab same, sirf ordering badli hai)
-- ------------------------------------------------------------
create or replace function public.jobs_feed()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.wallet_require_user();
begin
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name, 'color', color) order by sort), '[]'::jsonb)
      from public.job_categories),
    'config', jsonb_build_object(
      'platformFeePct', (select platform_fee_pct from public.wallet_config where id = 1),
      'minJobReward', (select min_job_reward from public.wallet_config where id = 1)),
    'quota', public.jobs_quota(),
    -- open jobs: highest paying first, then newest
    'open', (select coalesce(jsonb_agg(j order by (j ->> 'reward')::numeric desc,
                                                  (j ->> 'createdAt')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'ownerName', public.wallet_display_name(jb.owner),
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb
        where jb.status = 'active' and jb.filled < jb.slots and jb.owner <> v_user
          and not exists (select 1 from public.job_subs s where s.job_id = jb.id and s.worker = v_user)
      ) o),
    'mine', (select coalesce(jsonb_agg(j order by j ->> 'createdAt' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'escrow', jb.escrow, 'fee', jb.fee, 'status', jb.status,
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb where jb.owner = v_user
      ) m),
    'mySubs', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'proof', s.proof, 'note', s.note, 'status', s.status, 'reason', s.reason,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.worker = v_user
      ) ms),
    'inbox', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'workerName', public.wallet_display_name(s.worker),
          'proof', s.proof, 'note', s.note, 'status', s.status,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.owner = v_user and s.status = 'pending'
      ) i)
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. jobs_submit_proof — paused task par kaam na ho
-- ------------------------------------------------------------
create or replace function public.jobs_submit_proof(p_job uuid, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;
  if j.owner = v_user then raise exception 'You cannot work on your own task' using errcode = 'P0001'; end if;
  if j.status = 'paused' then raise exception 'This task is paused right now' using errcode = 'P0001'; end if;
  if j.status <> 'active' or j.filled >= j.slots then
    raise exception 'This task is already full' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.job_subs where job_id = p_job and worker = v_user) then
    raise exception 'You already submitted this task' using errcode = 'P0001';
  end if;
  if p_proof is null or length(trim(p_proof)) < 6 then
    raise exception 'Add your proof (link, screenshot URL, username or ID)' using errcode = 'P0001';
  end if;

  insert into public.job_subs (job_id, worker, owner, reward, proof, note)
  values (p_job, v_user, j.owner, j.reward, trim(p_proof), coalesce(trim(p_note), ''));

  return public.jobs_feed();
end;
$$;

-- ============================================================
-- 5. ADMIN — posted tasks list / edit / approve / pause / delete
-- ============================================================

create or replace function public.admin_jobs_list()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name, 'color', color) order by sort), '[]'::jsonb)
      from public.job_categories),
    'total', (select count(*) from public.jobs),
    'jobs', coalesce((
      select jsonb_agg(t order by t ->> 'createdAt' desc)
      from (
        select jsonb_build_object(
          'id', j.id, 'title', j.title, 'category', j.category,
          'description', j.description, 'url', j.url, 'proofNote', j.proof_note,
          'reward', j.reward, 'slots', j.slots, 'filled', j.filled,
          'escrow', j.escrow, 'fee', j.fee, 'status', j.status,
          'createdAt', extract(epoch from j.created_at) * 1000,
          'ownerId', j.owner,
          'ownerName', coalesce(nullif(trim(p.display_name), ''), 'Member'),
          'ownerEmail', coalesce(p.email, ''),
          'pending', (select count(*) from public.job_subs s
                       where s.job_id = j.id and s.status = 'pending'),
          'approved', (select count(*) from public.job_subs s
                        where s.job_id = j.id and s.status = 'approved')
        ) as t
        from public.jobs j
        left join public.profiles p on p.id = j.owner
      ) s
    ), '[]'::jsonb));
end;
$$;

-- Edit: title / category / description / link / proof note / reward / slots.
-- Reward ya slots badalne par bache hue slots ka escrow dobara calculate
-- hota hai — kam ho to owner ko refund, jyada ho to owner ke wallet se
-- top-up (paisa kam ho to error, taki escrow kabhi short na pade).
create or replace function public.admin_jobs_update(
  p_job         uuid,
  p_title       text,
  p_category    text,
  p_description text,
  p_url         text,
  p_proof_note  text,
  p_reward      numeric,
  p_slots       int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
  v_cat text;
  v_reward numeric; v_slots int;
  v_need numeric; v_diff numeric;
  bal public.balances;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;

  if p_title is null or length(trim(p_title)) < 6 then
    raise exception 'Task title must be at least 6 characters' using errcode = 'P0001';
  end if;

  v_cat    := coalesce(nullif(trim(p_category), ''), j.category);
  if not exists (select 1 from public.job_categories where key = v_cat) then
    raise exception 'Unknown task category' using errcode = 'P0001';
  end if;

  v_reward := coalesce(p_reward, j.reward);
  v_slots  := coalesce(p_slots,  j.slots);
  if v_reward <= 0 then raise exception 'Reward must be greater than 0' using errcode = 'P0001'; end if;
  if v_slots < greatest(j.filled, 1) then
    raise exception 'Slots cannot be lower than the % already filled', j.filled using errcode = 'P0001';
  end if;

  /* bache hue (unfilled) slots ke liye kitna escrow chahiye */
  v_need := round(v_reward * (v_slots - j.filled), 8);
  if j.status in ('cancelled', 'completed') then v_need := j.escrow; end if;
  v_diff := round(v_need - j.escrow, 8);

  if v_diff <> 0 then
    insert into public.balances (user_id) values (j.owner) on conflict (user_id) do nothing;
    select * into bal from public.balances where user_id = j.owner for update;

    if v_diff > 0 then
      if bal.usdt < v_diff then
        raise exception 'Owner needs $% more USDT in their wallet for this change — they have $%',
          round(v_diff, 2), round(bal.usdt, 2) using errcode = 'P0001';
      end if;
      update public.balances
         set usdt = round(usdt - v_diff, 8), locked = round(locked + v_diff, 8), updated_at = now()
       where user_id = j.owner;
      perform public.wallet_tx(j.owner, 'escrow', -v_diff,
        'Extra escrow after an admin edited "' || trim(p_title) || '"', 'completed', null, j.id);
    else
      update public.balances
         set locked = round(locked + v_diff, 8), usdt = round(usdt - v_diff, 8), updated_at = now()
       where user_id = j.owner;
      perform public.wallet_tx(j.owner, 'refund', -v_diff,
        'Escrow released after an admin edited "' || trim(p_title) || '"', 'completed', null, j.id);
    end if;
  end if;

  update public.jobs set
    title       = trim(p_title),
    category    = v_cat,
    description = coalesce(nullif(trim(p_description), ''), description),
    url         = coalesce(trim(p_url), ''),
    proof_note  = coalesce(nullif(trim(p_proof_note), ''), proof_note),
    reward      = v_reward,
    slots       = v_slots,
    escrow      = v_need
  where id = j.id;

  return public.admin_jobs_list();
end;
$$;

-- Approve = task ko live karo, Pause = rok do (escrow safe rehta hai).
create or replace function public.admin_jobs_set_status(p_job uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  if coalesce(p_status, '') not in ('active', 'paused', 'completed') then
    raise exception 'Status must be active, paused or completed' using errcode = 'P0001';
  end if;

  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;
  if j.status = 'cancelled' then
    raise exception 'This task was cancelled — escrow is already refunded' using errcode = 'P0001';
  end if;

  update public.jobs set status = p_status where id = j.id;
  return public.admin_jobs_list();
end;
$$;

-- Delete = bacha hua escrow owner ko wapas, phir task + uske proofs delete.
create or replace function public.admin_jobs_delete(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_refund numeric;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;

  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;

  v_refund := greatest(0, coalesce(j.escrow, 0));
  if v_refund > 0 then
    insert into public.balances (user_id) values (j.owner) on conflict (user_id) do nothing;
    update public.balances
       set locked = round(locked - v_refund, 8), usdt = round(usdt + v_refund, 8), updated_at = now()
     where user_id = j.owner;
    perform public.wallet_tx(j.owner, 'refund', v_refund,
      'Task deleted by an admin: "' || j.title || '"', 'completed', null, null);
  end if;

  delete from public.jobs where id = j.id;
  return public.admin_jobs_list();
end;
$$;

-- ------------------------------------------------------------
-- 6. Permissions
-- ------------------------------------------------------------
revoke all on function public.jobs_post(text, text, text, text, text, numeric, int) from public, anon;
revoke all on function public.jobs_quota()                                          from public, anon;
revoke all on function public.jobs_feed()                                           from public, anon;
revoke all on function public.jobs_submit_proof(uuid, text, text)                   from public, anon;
revoke all on function public.admin_jobs_list()                                     from public, anon;
revoke all on function public.admin_jobs_update(uuid, text, text, text, text, text, numeric, int) from public, anon;
revoke all on function public.admin_jobs_set_status(uuid, text)                     from public, anon;
revoke all on function public.admin_jobs_delete(uuid)                               from public, anon;

grant execute on function public.jobs_post(text, text, text, text, text, numeric, int) to authenticated;
grant execute on function public.jobs_quota()                                          to authenticated;
grant execute on function public.jobs_feed()                                           to authenticated;
grant execute on function public.jobs_submit_proof(uuid, text, text)                   to authenticated;
grant execute on function public.admin_jobs_list()                                     to authenticated;
grant execute on function public.admin_jobs_update(uuid, text, text, text, text, text, numeric, int) to authenticated;
grant execute on function public.admin_jobs_set_status(uuid, text)                     to authenticated;
grant execute on function public.admin_jobs_delete(uuid)                               to authenticated;

notify pgrst, 'reload schema';
