-- User-owned V1 aggregate. Habits, categories and improvements are stored in the JSON model.
-- Empty workspaces receive no seeded records; legacy Driving data is wrapped once on load.
create table if not exists public.driving_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and coalesce(data->>'version', '') = '1'
    and jsonb_typeof(data->'categories') = 'array'
    and jsonb_typeof(data->'mistakes') = 'array'
    and octet_length(data::text) <= 500000
  ),
  updated_at timestamptz not null default now()
);
alter table public.driving_workspaces enable row level security;
create policy "Read own driving improvement" on public.driving_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "Insert own driving improvement" on public.driving_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own driving improvement" on public.driving_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.driving_workspaces to authenticated;
grant delete on public.driving_workspaces to authenticated;
revoke all on public.driving_workspaces from anon;
create policy "Delete own driving improvement" on public.driving_workspaces for delete to authenticated using ((select auth.uid()) = user_id);
