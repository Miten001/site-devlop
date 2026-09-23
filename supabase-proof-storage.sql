-- FlexFam — proof screenshots ke liye Supabase Storage bucket
--
-- KYA HAI YE: Task proof mein ab screenshot ATTACH karne ka option hai.
-- File Supabase Storage (bucket: "proofs") me upload hoti hai aur
-- task owner (buyer) use "My Tasks -> View" me dekh sakta hai.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> is POORE
-- file ko paste karo -> Run. "Success" dikhna chahiye.
-- Safe to re-run (idempotent).
--
-- NOTE: sirf LOGIN kiye hue members upload kar sakte hain, sirf image
-- files (png/jpg/webp/gif), aur sab koi upload ki hui file padh sakta hai
-- (owner ko dikhana hai isliye public read zaroori hai).

-- ============================================================
-- 1. Bucket banao (public read — owner proof kholkar dekh sakta hai)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', true)
on conflict (id) do update set public = true;

-- ============================================================
-- 2. Policies
-- ============================================================

-- login kiye hue members hi upload kar sakte hain, sirf image extensions
drop policy if exists "proofs authenticated image upload" on storage.objects;
create policy "proofs authenticated image upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proofs'
  and storage.extension(name) in ('png', 'jpg', 'jpeg', 'webp', 'gif')
);

-- public read — proof ka link kholke owner screenshot dekh sakta hai
drop policy if exists "proofs public read" on storage.objects;
create policy "proofs public read"
on storage.objects for select to public
using (bucket_id = 'proofs');

-- upload hone ke baad koi file delete/overwrite na kar sake
drop policy if exists "proofs no update" on storage.objects;
create policy "proofs no update"
on storage.objects for update to authenticated
using (false) with check (false);
