create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric not null check (weight_kg > 0 and weight_kg <= 1000),
  note text not null default '' check (char_length(note) <= 1000),
  photo_path text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, date),
  check (photo_path is null or split_part(photo_path, '/', 1) = user_id::text)
);
alter table public.weight_entries enable row level security;
grant select, insert, update, delete on public.weight_entries to authenticated;
create policy "Own weight entries" on public.weight_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('weight-photos', 'weight-photos', false, 1500000, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy "Read own weight photos" on storage.objects for select to authenticated
using (bucket_id = 'weight-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Upload own weight photos" on storage.objects for insert to authenticated
with check (bucket_id = 'weight-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Delete own weight photos" on storage.objects for delete to authenticated
using (bucket_id = 'weight-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
