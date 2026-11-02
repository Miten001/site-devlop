-- FlexFam — proof screenshots ke liye Supabase Storage bucket
--
-- KYA HAI YE: Task proof (USDT Task Market) aur campaign proof (Earn page)
-- dono me ab typed text KE SAATH screenshot / short video ATTACH karne ka
-- option hai. File Supabase Storage (bucket: "proofs") me upload hoti hai aur
-- task owner (My Tasks → View / All submissions), admin (Proofs, Payments,
-- member modal) aur worker (My submissions) use full size me dekh sakte hain.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> is POORE
-- file ko paste karo -> Run. "Success" dikhna chahiye.
-- Safe to re-run (idempotent).
--
-- NOTE: sirf LOGIN kiye hue members upload kar sakte hain, sirf image/video
-- files, aur sab koi upload ki hui file padh sakta hai (owner ko dikhana hai
-- isliye public read zaroori hai). Agar ye file abhi run nahi hui hai to bhi
-- proof gayab nahi hota — site screenshot ka compressed copy proof text me
-- embed kar deti hai (offline fallback).

-- ============================================================
-- 1. Bucket banao (public read — owner proof kholkar dekh sakta hai)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', true)
on conflict (id) do update set public = true;

-- Naye Supabase versions me bucket-level size / mime limit set kar sakte hain.
-- Purane versions me ye columns nahi hote — isliye guard ke saath (safe).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 8388608 where id = 'proofs'; -- 8 MB
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets
       set allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','video/mp4','video/webm','video/quicktime']
     where id = 'proofs';
  end if;
end $$;

-- ============================================================
-- 2. Policies
-- ============================================================

-- login kiye hue members hi upload kar sakte hain, sirf image/video extensions
drop policy if exists "proofs authenticated image upload" on storage.objects;
drop policy if exists "proofs authenticated media upload" on storage.objects;
create policy "proofs authenticated media upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proofs'
  and storage.extension(name) in ('png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm', 'mov')
);

-- public read — proof ka link kholke owner / admin screenshot dekh sakta hai
drop policy if exists "proofs public read" on storage.objects;
create policy "proofs public read"
on storage.objects for select to public
using (bucket_id = 'proofs');

-- upload hone ke baad koi file delete/overwrite na kar sake
drop policy if exists "proofs no update" on storage.objects;
create policy "proofs no update"
on storage.objects for update to authenticated
using (false) with check (false);
