alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists avatar_path text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_length') then
    alter table public.profiles add constraint profiles_display_name_length check (char_length(display_name) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_owner_path') then
    alter table public.profiles add constraint profiles_avatar_owner_path check (avatar_path is null or split_part(avatar_path, '/', 1) = user_id::text);
  end if;
end $$;


create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(new.raw_user_meta_data ->> 'username'));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  insert into public.profiles (user_id, username, email, display_name)
  values (new.id, requested_username, lower(new.email), coalesce(nullif(requested_display_name, ''), requested_username));

  return new;
end;
$$;

grant select on public.profiles to authenticated;
revoke update on public.profiles from public, anon, authenticated;
grant update (username, display_name, avatar_path, updated_at) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 524288, array['image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Read own profile avatar" on storage.objects;
create policy "Read own profile avatar" on storage.objects for select to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Upload own profile avatar" on storage.objects;
create policy "Upload own profile avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Replace own profile avatar" on storage.objects;
create policy "Replace own profile avatar" on storage.objects for update to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Delete own profile avatar" on storage.objects;
create policy "Delete own profile avatar" on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
