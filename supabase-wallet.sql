-- FlexFam — server-side USDT wallet + task marketplace (Supabase / Postgres)
--
-- HOW TO RUN: run the migrations in this order, each as ONE script in the
-- Supabase SQL editor:
--     1. supabase.sql          (admins, profiles, is_admin())
--     2. supabase-mining.sql   (balances, mining, mining_config)
--     3. supabase-wallet.sql   (this file)
--
-- Safe to re-run as many times as you like.
--
-- WHY THIS EXISTS
-- The browser build keeps wallet balances, escrow and job state in
-- localStorage, which any user can rewrite from the devtools console. This
-- migration moves the authoritative money flow into Postgres:
--   * deposits, withdrawals, escrow and payouts live in tables with no
--     insert/update/delete policy for browsers,
--   * every mutation is a `security definer` RPC that recomputes amounts,
--     fees and ownership itself,
--   * escrow is locked and released inside a single transaction, so a
--     crash or a double-click cannot pay a worker twice.

-- ============================================================
-- 0. Prerequisites
-- ============================================================
do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'public.is_admin() is missing — run supabase.sql first';
  end if;
  if to_regclass('public.balances') is null then
    raise exception 'public.balances is missing — run supabase-mining.sql before this file';
  end if;
end;
$$;

-- The wallet shares public.balances with mining (usdt = available spendable).
-- Add the escrow + lifetime columns the wallet UI needs.
alter table public.balances add column if not exists locked          numeric not null default 0;
alter table public.balances add column if not exists total_earned    numeric not null default 0;
alter table public.balances add column if not exists total_deposited numeric not null default 0;
alter table public.balances add column if not exists total_withdrawn numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'balances_locked_nonneg') then
    alter table public.balances add constraint balances_locked_nonneg check (locked >= 0);
  end if;
end;
$$;

-- ============================================================
-- 1. Wallet configuration (public read, admin-only write)
-- ============================================================

create table if not exists public.wallet_config (
  id                 int primary key default 1 check (id = 1),
  min_deposit        numeric not null default 10,
  min_withdraw       numeric not null default 10,
  withdraw_fee_pct   numeric not null default 1,
  platform_fee_pct   numeric not null default 5,
  min_points_convert int     not null default 1000,
  min_job_reward     numeric not null default 0.02,
  updated_at         timestamptz not null default now()
);

insert into public.wallet_config (id) values (1) on conflict (id) do nothing;
-- Keep existing installations aligned with the advertised $10 minimum.
update public.wallet_config set min_withdraw = 10, updated_at = now() where id = 1 and min_withdraw <> 10;

-- Only chains with a real, verified receiving wallet belong here.
create table if not exists public.wallet_networks (
  network     text primary key,
  deposit     boolean not null default true,
  withdraw    boolean not null default true,
  address     text,
  qr          text,
  note        text not null default '',
  sort        int  not null default 0
);

insert into public.wallet_networks (network, deposit, withdraw, address, qr, note, sort) values
  ('BEP20 (BSC)', true, true,
   '0xe85d1b6b330219de89e826f314a9bc2bcd595e53',
   'assets/img/deposit-bep20-qr.png',
   'BNB Smart Chain (BEP20) only. Do not send NFTs or any other token to this address.', 1),
  ('UPI', true, true,
   'ravanyt001-2@okaxis',
   'assets/img/deposit-upi-qr.png',
   'Pay the INR equivalent to this UPI ID, then submit your 12-digit UTR / reference number. Credited after manual review.', 2)
on conflict (network) do update set
  deposit = excluded.deposit, withdraw = excluded.withdraw,
  address = excluded.address, qr = excluded.qr, note = excluded.note, sort = excluded.sort;

create table if not exists public.job_categories (
  key   text primary key,
  name  text not null,
  color text not null default '#7c3aed',
  sort  int  not null default 0
);

insert into public.job_categories (key, name, color, sort) values
  ('social',  'Social Media',         '#e0489f', 1),
  ('app',     'App Install & Review', '#22d3ee', 2),
  ('signup',  'Sign Up / Referral',   '#34e5a5', 3),
  ('content', 'Content & Writing',    '#ffd166', 4),
  ('video',   'Video & Watch Time',   '#ff3355', 5),
  ('crypto',  'Crypto & Airdrop',     '#a970ff', 6),
  ('survey',  'Survey & Feedback',    '#2aabee', 7),
  ('other',   'Other Micro Work',     '#ff8a3d', 8)
on conflict (key) do update set name = excluded.name, color = excluded.color, sort = excluded.sort;

-- ============================================================
-- 2. Ledger + requests + marketplace tables
-- ============================================================

create table if not exists public.wallet_txns (
  id      bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type    text not null,
  amount  numeric not null,
  note    text not null default '',
  status  text not null default 'completed' check (status in ('pending','completed','rejected')),
  ref_id  uuid,
  job_id  uuid,
  at      timestamptz not null default now()
);

create index if not exists wallet_txns_user_idx on public.wallet_txns (user_id, at desc);

create table if not exists public.pay_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('deposit','withdraw')),
  amount     numeric not null check (amount > 0),
  fee        numeric not null default 0,
  receive    numeric not null default 0,
  network    text not null,
  txid       text,
  address    text,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  at         timestamptz not null default now(),
  settled_at timestamptz,
  admin_note text not null default ''
);

create index if not exists pay_requests_status_idx on public.pay_requests (status, at desc);
create index if not exists pay_requests_user_idx   on public.pay_requests (user_id, at desc);

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  category    text not null default 'other',
  description text not null,
  url         text not null default '',
  proof_note  text not null default 'Screenshot / proof link of the completed action',
  reward      numeric not null check (reward > 0),
  slots       int     not null check (slots > 0),
  filled      int     not null default 0 check (filled >= 0),
  escrow      numeric not null default 0 check (escrow >= 0),
  fee         numeric not null default 0,
  status      text    not null default 'active' check (status in ('active','completed','cancelled')),
  created_at  timestamptz not null default now()
);

create index if not exists jobs_status_idx on public.jobs (status, created_at desc);
create index if not exists jobs_owner_idx  on public.jobs (owner, created_at desc);

create table if not exists public.job_subs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  worker      uuid not null references auth.users(id) on delete cascade,
  owner       uuid not null references auth.users(id) on delete cascade,
  reward      numeric not null,
  proof       text not null,
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason      text not null default '',
  at          timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (job_id, worker)
);

create index if not exists job_subs_job_idx    on public.job_subs (job_id);
create index if not exists job_subs_worker_idx on public.job_subs (worker, at desc);
create index if not exists job_subs_owner_idx  on public.job_subs (owner, status);

-- ============================================================
-- 3. Internal helpers
-- ============================================================

create or replace function public.wallet_tx(
  p_user uuid, p_type text, p_amount numeric, p_note text,
  p_status text, p_ref uuid, p_job uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.wallet_txns (user_id, type, amount, note, status, ref_id, job_id)
  values (p_user, p_type, p_amount, coalesce(p_note, ''), coalesce(p_status, 'completed'), p_ref, p_job);
$$;

revoke all on function public.wallet_tx(uuid, text, numeric, text, text, uuid, uuid) from public, anon, authenticated;

-- "5" / "2.5" -> "5%" / "2.5%" for human-readable error copy
create or replace function public.wallet_pct_label(p_pct numeric)
returns text language sql immutable as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(p_pct, 'FM999990.00'))) || '%';
$$;

create or replace function public.wallet_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(display_name), '') from public.profiles where id = p_user),
    (select split_part(coalesce(email, 'member'), '@', 1) from auth.users where id = p_user),
    'Member');
$$;

revoke all on function public.wallet_display_name(uuid) from public, anon;
grant execute on function public.wallet_display_name(uuid) to authenticated;

create or replace function public.wallet_require_user()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Please log in to use your wallet' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- ============================================================
-- 4. Wallet RPC
-- ============================================================

create or replace function public.wallet_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
begin
  select * into cfg from public.wallet_config where id = 1;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user;

  return jsonb_build_object(
    'server', true,
    'now', extract(epoch from now()) * 1000,
    'config', jsonb_build_object(
      'minDeposit', cfg.min_deposit, 'minWithdraw', cfg.min_withdraw,
      'withdrawFeePct', cfg.withdraw_fee_pct, 'platformFeePct', cfg.platform_fee_pct,
      'minPointsConvert', cfg.min_points_convert, 'minJobReward', cfg.min_job_reward,
      'pointsPerUsdt', (select points_per_usdt from public.mining_config where id = 1)
    ),
    'networks', (select coalesce(jsonb_agg(jsonb_build_object(
        'network', network, 'deposit', deposit, 'withdraw', withdraw,
        'address', address, 'qr', qr, 'note', note) order by sort), '[]'::jsonb)
      from public.wallet_networks),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name, 'color', color) order by sort), '[]'::jsonb)
      from public.job_categories),
    'wallet', jsonb_build_object(
      'available', bal.usdt, 'locked', bal.locked, 'points', bal.points,
      'totalEarned', bal.total_earned, 'totalDeposited', bal.total_deposited,
      'totalWithdrawn', bal.total_withdrawn),
    'txns', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'type', type, 'amount', amount, 'note', note,
        'status', status, 'at', extract(epoch from at) * 1000) order by at desc), '[]'::jsonb)
      from (select * from public.wallet_txns where user_id = v_user order by at desc limit 200) t),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'amount', amount, 'fee', fee, 'receive', receive,
        'network', network, 'txid', txid, 'address', address, 'status', status,
        'at', extract(epoch from at) * 1000) order by at desc), '[]'::jsonb)
      from public.pay_requests where user_id = v_user)
  );
end;
$$;

create or replace function public.wallet_create_deposit(p_amount numeric, p_network text, p_txid text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  v_id uuid;
begin
  select * into cfg from public.wallet_config where id = 1;

  if p_amount is null or p_amount < cfg.min_deposit then
    raise exception 'Minimum deposit is $% USDT', cfg.min_deposit using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.wallet_networks where network = p_network and deposit) then
    raise exception 'Select a supported deposit network' using errcode = 'P0001';
  end if;
  if p_txid is null or length(trim(p_txid)) < 8 then
    if p_network = 'UPI' then
      raise exception 'Enter the UPI reference / UTR number from your payment app' using errcode = 'P0001';
    end if;
    raise exception 'Paste the transaction hash (TXID) from your wallet' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pay_requests where lower(txid) = lower(trim(p_txid))) then
    raise exception 'That transaction hash has already been submitted' using errcode = 'P0001';
  end if;

  insert into public.pay_requests (user_id, kind, amount, network, txid)
  values (v_user, 'deposit', p_amount, p_network, trim(p_txid))
  returning id into v_id;

  perform public.wallet_tx(v_user, 'deposit', p_amount,
    'Deposit via ' || p_network, 'pending', v_id, null);

  return public.wallet_state();
end;
$$;

create or replace function public.wallet_create_withdraw(p_amount numeric, p_network text, p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_fee numeric;
  v_id uuid;
begin
  select * into cfg from public.wallet_config where id = 1;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  if p_amount is null or p_amount < cfg.min_withdraw then
    raise exception 'Minimum withdrawal is $% USDT', cfg.min_withdraw using errcode = 'P0001';
  end if;
  if p_amount > bal.usdt then
    raise exception 'Not enough available balance — you have $%', round(bal.usdt, 2) using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.wallet_networks where network = p_network and withdraw) then
    raise exception 'Select a supported payout method' using errcode = 'P0001';
  end if;
  if p_network = 'UPI' then
    -- NOTE: a Postgres regex repetition count may not exceed 255, so the
    -- local part is capped at 255 here (a UPI ID is far shorter anyway).
    -- Using {2,256} raises: invalid regular expression: invalid repetition count(s)
    if p_address is null or trim(p_address) !~* '^[A-Z0-9._-]{2,255}@[A-Z0-9.-]{2,64}$' then
      raise exception 'Enter a valid UPI ID (for example, name@bank)' using errcode = 'P0001';
    end if;
  elsif p_address is null or length(trim(p_address)) < 15 then
    raise exception 'Enter a valid USDT wallet address' using errcode = 'P0001';
  end if;

  v_fee := round(p_amount * cfg.withdraw_fee_pct / 100.0, 2);

  -- move the money out of spendable and into locked in the same statement
  update public.balances
     set usdt = round(usdt - p_amount, 8), locked = round(locked + p_amount, 8), updated_at = now()
   where user_id = v_user;

  insert into public.pay_requests (user_id, kind, amount, fee, receive, network, address)
  values (v_user, 'withdraw', p_amount, v_fee, round(p_amount - v_fee, 2), p_network, trim(p_address))
  returning id into v_id;

  perform public.wallet_tx(v_user, 'withdraw', -p_amount,
    'Withdrawal to ' || p_network || ' (fee $' || v_fee || ')', 'pending', v_id, null);

  return public.wallet_state();
end;
$$;

create or replace function public.wallet_convert_points(p_points bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
  v_rate int;
  v_amount numeric;
begin
  select * into cfg from public.wallet_config where id = 1;
  select points_per_usdt into v_rate from public.mining_config where id = 1;
  insert into public.balances (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into bal from public.balances where user_id = v_user for update;

  if p_points is null or p_points < cfg.min_points_convert then
    raise exception 'Minimum % points to convert', cfg.min_points_convert using errcode = 'P0001';
  end if;
  if bal.points < p_points then
    raise exception 'Not enough points — you have %', bal.points using errcode = 'P0001';
  end if;

  v_amount := round(p_points::numeric / v_rate, 6);

  update public.balances
     set points = points - p_points,
         usdt = round(usdt + v_amount, 8),
         total_earned = round(total_earned + v_amount, 8),
         updated_at = now()
   where user_id = v_user;

  perform public.wallet_tx(v_user, 'convert', v_amount,
    p_points || ' points converted to USDT', 'completed', null, null);

  return public.wallet_state();
end;
$$;

-- ============================================================
-- 5. Marketplace RPC
-- ============================================================

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
    -- open jobs: active, has free slots, not mine, not already submitted by me
    'open', (select coalesce(jsonb_agg(j order by j ->> 'createdAt' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'ownerName', public.wallet_display_name(jb.owner),
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb
        where jb.status = 'active' and jb.filled < jb.slots and jb.owner <> v_user
          and not exists (select 1 from public.job_subs s where s.job_id = jb.id and s.worker = v_user)
      ) o),
    -- my own postings
    'mine', (select coalesce(jsonb_agg(j order by j ->> 'createdAt' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', jb.id, 'title', jb.title, 'category', jb.category, 'description', jb.description,
          'url', jb.url, 'proofNote', jb.proof_note, 'reward', jb.reward, 'slots', jb.slots,
          'filled', jb.filled, 'escrow', jb.escrow, 'fee', jb.fee, 'status', jb.status,
          'createdAt', extract(epoch from jb.created_at) * 1000) as j
        from public.jobs jb where jb.owner = v_user
      ) m),
    -- proofs I sent
    'mySubs', (select coalesce(jsonb_agg(j order by j ->> 'at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', s.id, 'jobId', s.job_id, 'jobTitle', jb.title, 'reward', s.reward,
          'proof', s.proof, 'note', s.note, 'status', s.status, 'reason', s.reason,
          'at', extract(epoch from s.at) * 1000) as j
        from public.job_subs s join public.jobs jb on jb.id = s.job_id
        where s.worker = v_user
      ) ms),
    -- proofs waiting on me
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

create or replace function public.jobs_post(
  p_title text, p_category text, p_description text, p_url text,
  p_proof_note text, p_reward numeric, p_slots int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  cfg public.wallet_config;
  bal public.balances;
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
  if not exists (select 1 from public.job_categories where key = coalesce(p_category, 'other')) then
    raise exception 'Unknown task category' using errcode = 'P0001';
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

  -- escrow: leave spendable, enter locked
  update public.balances
     set usdt = round(usdt - v_total, 8), locked = round(locked + v_budget, 8), updated_at = now()
   where user_id = v_user;

  insert into public.jobs (owner, title, category, description, url, proof_note, reward, slots, escrow, fee)
  values (v_user, trim(p_title), coalesce(p_category, 'other'), trim(p_description),
          coalesce(trim(p_url), ''),
          coalesce(nullif(trim(p_proof_note), ''), 'Screenshot / proof link of the completed action'),
          p_reward, p_slots, v_budget, v_fee);

  perform public.wallet_tx(v_user, 'escrow', -v_total,
    'Escrow for task "' || trim(p_title) || '" (' || p_slots || ' slots + ' || cfg.platform_fee_pct || '% fee)',
    'completed', null, null);

  return public.jobs_feed();
end;
$$;

create or replace function public.jobs_submit_proof(p_job uuid, p_proof text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;
  if j.owner = v_user then raise exception 'You cannot work on your own task' using errcode = 'P0001'; end if;
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

-- Approve or reject a proof. The payout comes out of the escrow that was
-- locked when the job was posted and the whole thing is one transaction, so a
-- worker can never be paid twice. Shared by the owner review (jobs_review) and
-- the admin override (jobs_admin_review); p_admin skips the ownership check.
-- Not granted to anyone: it is only ever reached through those two wrappers.
create or replace function public.wallet_settle_sub(p_sub uuid, p_approve boolean, p_reason text, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  s public.job_subs;
  j public.jobs;
begin
  select * into s from public.job_subs where id = p_sub for update;
  if not found then raise exception 'Submission not found' using errcode = 'P0001'; end if;
  if not p_admin and s.owner <> v_user then
    raise exception 'Only the task owner can review this proof' using errcode = 'P0001';
  end if;
  if s.status <> 'pending' then raise exception 'Already reviewed' using errcode = 'P0001'; end if;

  select * into j from public.jobs where id = s.job_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;

  update public.job_subs
     set status = case when p_approve then 'approved' else 'rejected' end,
         reason = coalesce(p_reason, ''), reviewed_at = now()
   where id = p_sub;

  if p_approve then
    if j.escrow < j.reward then
      raise exception 'Escrow for this task is exhausted' using errcode = 'P0001';
    end if;

    -- release from the owner's locked escrow into the worker's balance
    update public.balances
       set locked = round(locked - j.reward, 8), updated_at = now()
     where user_id = j.owner;

    insert into public.balances (user_id) values (s.worker) on conflict (user_id) do nothing;
    update public.balances
       set usdt = round(usdt + j.reward, 8),
           total_earned = round(total_earned + j.reward, 8), updated_at = now()
     where user_id = s.worker;

    update public.jobs
       set filled = filled + 1,
           escrow = round(escrow - j.reward, 8),
           status = case when filled + 1 >= slots then 'completed' else status end
     where id = j.id;

    perform public.wallet_tx(j.owner, 'payout', -j.reward,
      'Paid ' || public.wallet_display_name(s.worker) || ' for "' || j.title || '"', 'completed', null, j.id);
    perform public.wallet_tx(s.worker, 'earning', j.reward,
      'Task approved: "' || j.title || '"', 'completed', null, j.id);
  end if;

  return;
end;
$$;

create or replace function public.jobs_review(p_sub uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.wallet_settle_sub(p_sub, p_approve, p_reason, false);
  return public.jobs_feed();
end;
$$;

create or replace function public.jobs_admin_review(p_sub uuid, p_approve boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = 'P0001'; end if;
  perform public.wallet_settle_sub(p_sub, p_approve, p_reason, true);
  return public.wallet_admin_queue();
end;
$$;

create or replace function public.jobs_cancel(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.wallet_require_user();
  j public.jobs;
  v_refund numeric;
begin
  select * into j from public.jobs where id = p_job for update;
  if not found or j.owner <> v_user then raise exception 'Task not found' using errcode = 'P0001'; end if;
  if j.status = 'cancelled' then raise exception 'Already cancelled' using errcode = 'P0001'; end if;

  v_refund := greatest(0, j.escrow);

  update public.jobs set status = 'cancelled', escrow = 0 where id = j.id;

  if v_refund > 0 then
    update public.balances
       set locked = round(locked - v_refund, 8), usdt = round(usdt + v_refund, 8), updated_at = now()
     where user_id = v_user;
    perform public.wallet_tx(v_user, 'refund', v_refund,
      'Refund from cancelled task "' || j.title || '"', 'completed', null, j.id);
  end if;

  return public.jobs_feed();
end;
$$;

-- ============================================================
-- 6. Admin RPC — settle deposits and withdrawals
-- ============================================================

create or replace function public.wallet_admin_queue()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'pending', (select coalesce(jsonb_agg(r order by r ->> 'at'), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'email', u.email, 'name', public.wallet_display_name(p.user_id),
        'amount', p.amount, 'fee', p.fee, 'receive', p.receive, 'network', p.network,
        'txid', p.txid, 'address', p.address,
        'at', extract(epoch from p.at) * 1000) as r
      from public.pay_requests p join auth.users u on u.id = p.user_id
      where p.status = 'pending') q),
    'history', (select coalesce(jsonb_agg(r order by r ->> 'settledAt' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'email', u.email, 'amount', p.amount,
        'status', p.status, 'settledAt', extract(epoch from coalesce(p.settled_at, p.at)) * 1000) as r
      from public.pay_requests p join auth.users u on u.id = p.user_id
      where p.status <> 'pending' order by p.settled_at desc nulls last limit 100) h),
    'jobs', (select coalesce(jsonb_agg(r order by r ->> 'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', j.id, 'title', j.title, 'email', u.email, 'category', j.category,
        'reward', j.reward, 'slots', j.slots, 'filled', j.filled, 'escrow', j.escrow,
        'status', j.status, 'createdAt', extract(epoch from j.created_at) * 1000) as r
      from public.jobs j join auth.users u on u.id = j.owner limit 300) jj),
    'subs', (select coalesce(jsonb_agg(r order by r ->> 'at' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', s.id, 'jobId', s.job_id, 'jobTitle', j.title, 'reward', s.reward,
        'workerName', public.wallet_display_name(s.worker), 'workerEmail', u.email,
        'proof', s.proof, 'note', s.note, 'status', s.status,
        'at', extract(epoch from s.at) * 1000) as r
      from public.job_subs s
      join public.jobs j on j.id = s.job_id
      join auth.users u on u.id = s.worker
      where s.status = 'pending' limit 300) ss),
    'totals', jsonb_build_object(
      'escrow', (select coalesce(sum(escrow), 0) from public.jobs where status = 'active'),
      'available', (select coalesce(sum(usdt), 0) from public.balances),
      'locked', (select coalesce(sum(locked), 0) from public.balances),
      'deposited', (select coalesce(sum(total_deposited), 0) from public.balances),
      'withdrawn', (select coalesce(sum(total_withdrawn), 0) from public.balances))
  );
end;
$$;

create or replace function public.wallet_admin_settle(p_request uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.pay_requests;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = 'P0001'; end if;

  select * into r from public.pay_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'Already settled' using errcode = 'P0001'; end if;

  update public.pay_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         settled_at = now(), admin_note = coalesce(p_note, '')
   where id = r.id;

  insert into public.balances (user_id) values (r.user_id) on conflict (user_id) do nothing;

  if r.kind = 'deposit' then
    if p_approve then
      update public.balances
         set usdt = round(usdt + r.amount, 8),
             total_deposited = round(total_deposited + r.amount, 8), updated_at = now()
       where user_id = r.user_id;
    end if;
  else
    -- withdrawal: the amount has been sitting in locked since the request
    if p_approve then
      update public.balances
         set locked = round(locked - r.amount, 8),
             total_withdrawn = round(total_withdrawn + r.amount, 8), updated_at = now()
       where user_id = r.user_id;
    else
      update public.balances
         set locked = round(locked - r.amount, 8), usdt = round(usdt + r.amount, 8), updated_at = now()
       where user_id = r.user_id;
    end if;
  end if;

  update public.wallet_txns
     set status = case when p_approve then 'completed' else 'rejected' end
   where ref_id = r.id;

  return public.wallet_admin_queue();
end;
$$;

create or replace function public.jobs_admin_cancel(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_refund numeric;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = 'P0001'; end if;
  select * into j from public.jobs where id = p_job for update;
  if not found then raise exception 'Task not found' using errcode = 'P0001'; end if;
  if j.status = 'cancelled' then raise exception 'Already cancelled' using errcode = 'P0001'; end if;

  v_refund := greatest(0, j.escrow);
  update public.jobs set status = 'cancelled', escrow = 0 where id = j.id;
  if v_refund > 0 then
    update public.balances
       set locked = round(locked - v_refund, 8), usdt = round(usdt + v_refund, 8), updated_at = now()
     where user_id = j.owner;
    perform public.wallet_tx(j.owner, 'refund', v_refund,
      'Task cancelled by an admin: "' || j.title || '"', 'completed', null, j.id);
  end if;

  return public.wallet_admin_queue();
end;
$$;

-- ============================================================
-- 7. Row level security
-- ============================================================

alter table public.wallet_config   enable row level security;
alter table public.wallet_networks enable row level security;
alter table public.job_categories  enable row level security;
alter table public.wallet_txns     enable row level security;
alter table public.pay_requests    enable row level security;
alter table public.jobs            enable row level security;
alter table public.job_subs        enable row level security;

drop policy if exists "anyone reads wallet config"   on public.wallet_config;
drop policy if exists "anyone reads wallet networks" on public.wallet_networks;
drop policy if exists "anyone reads job categories"  on public.job_categories;
drop policy if exists "members read own txns"        on public.wallet_txns;
drop policy if exists "members read own requests"    on public.pay_requests;
drop policy if exists "members read open jobs"       on public.jobs;
drop policy if exists "members read related subs"    on public.job_subs;
drop policy if exists "admins read all requests"     on public.pay_requests;
drop policy if exists "admins read all txns"         on public.wallet_txns;
drop policy if exists "admins read all subs"         on public.job_subs;

create policy "anyone reads wallet config" on public.wallet_config
  for select to anon, authenticated using (true);
create policy "anyone reads wallet networks" on public.wallet_networks
  for select to anon, authenticated using (true);
create policy "anyone reads job categories" on public.job_categories
  for select to anon, authenticated using (true);

create policy "members read own txns" on public.wallet_txns
  for select to authenticated using (user_id = auth.uid());
create policy "members read own requests" on public.pay_requests
  for select to authenticated using (user_id = auth.uid());

-- Job listings are the public part of the marketplace; a worker has to be
-- able to see a job before claiming it. Only non-sensitive columns exist here.
create policy "members read open jobs" on public.jobs
  for select to authenticated using (status <> 'cancelled' or owner = auth.uid());

-- A submission is visible to its worker and to the job owner, nobody else.
create policy "members read related subs" on public.job_subs
  for select to authenticated using (worker = auth.uid() or owner = auth.uid());

create policy "admins read all requests" on public.pay_requests
  for select to authenticated using (public.is_admin());
create policy "admins read all txns" on public.wallet_txns
  for select to authenticated using (public.is_admin());
create policy "admins read all subs" on public.job_subs
  for select to authenticated using (public.is_admin());

-- Supabase grants table privileges to anon/authenticated by default; state the
-- intended reads explicitly so the policies above are the only thing deciding
-- visibility, on a fresh project or a locked-down one alike.
grant select on public.wallet_config, public.wallet_networks, public.job_categories
  to anon, authenticated;
grant select on public.wallet_txns, public.pay_requests, public.jobs, public.job_subs
  to authenticated;

-- No insert / update / delete policy anywhere: the RPCs are the only writers.
revoke insert, update, delete on
  public.wallet_config, public.wallet_networks, public.job_categories,
  public.wallet_txns, public.pay_requests, public.jobs, public.job_subs
  from anon, authenticated;

-- ============================================================
-- 8. Grants
-- ============================================================

revoke all on function public.wallet_state()                                  from public, anon;
revoke all on function public.wallet_create_deposit(numeric, text, text)      from public, anon;
revoke all on function public.wallet_create_withdraw(numeric, text, text)     from public, anon;
revoke all on function public.wallet_convert_points(bigint)                   from public, anon;
revoke all on function public.jobs_feed()                                     from public, anon;
revoke all on function public.jobs_post(text, text, text, text, text, numeric, int) from public, anon;
revoke all on function public.jobs_submit_proof(uuid, text, text)             from public, anon;
revoke all on function public.wallet_settle_sub(uuid, boolean, text, boolean)  from public, anon, authenticated;
revoke all on function public.jobs_review(uuid, boolean, text)                from public, anon;
revoke all on function public.jobs_admin_review(uuid, boolean, text)          from public, anon;
revoke all on function public.jobs_cancel(uuid)                               from public, anon;
revoke all on function public.wallet_admin_queue()                            from public, anon;
revoke all on function public.wallet_admin_settle(uuid, boolean, text)        from public, anon;
revoke all on function public.jobs_admin_cancel(uuid)                         from public, anon;

grant execute on function public.wallet_state()                                  to authenticated;
grant execute on function public.wallet_create_deposit(numeric, text, text)      to authenticated;
grant execute on function public.wallet_create_withdraw(numeric, text, text)     to authenticated;
grant execute on function public.wallet_convert_points(bigint)                   to authenticated;
grant execute on function public.jobs_feed()                                     to authenticated;
grant execute on function public.jobs_post(text, text, text, text, text, numeric, int) to authenticated;
grant execute on function public.jobs_submit_proof(uuid, text, text)             to authenticated;
grant execute on function public.jobs_review(uuid, boolean, text)                to authenticated;
grant execute on function public.jobs_admin_review(uuid, boolean, text)          to authenticated;
grant execute on function public.jobs_cancel(uuid)                               to authenticated;
grant execute on function public.wallet_admin_queue()                            to authenticated;
grant execute on function public.wallet_admin_settle(uuid, boolean, text)        to authenticated;
grant execute on function public.jobs_admin_cancel(uuid)                         to authenticated;
