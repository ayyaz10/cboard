-- Atomic, user-owned aggregate: plans/library and session snapshots travel together.
-- The primary key is also the user lookup index. CAS prevents multi-device overwrites.
create table if not exists public.training_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  data jsonb not null check (jsonb_typeof(data) = 'object' and coalesce(data->>'version', '') = '1' and octet_length(data::text) <= 5000000),
  updated_at timestamptz not null default now()
);
alter table public.training_workspaces enable row level security;
create policy "Read own training" on public.training_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own training" on public.training_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own training" on public.training_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.training_workspaces to authenticated;
revoke all on public.training_workspaces from anon;
