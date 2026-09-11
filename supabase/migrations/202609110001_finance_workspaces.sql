create table if not exists public.finance_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_workspaces enable row level security;
grant select, insert, update, delete on public.finance_workspaces to authenticated;

drop policy if exists "finance_workspaces_select_own" on public.finance_workspaces;
create policy "finance_workspaces_select_own" on public.finance_workspaces for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "finance_workspaces_insert_own" on public.finance_workspaces;
create policy "finance_workspaces_insert_own" on public.finance_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "finance_workspaces_update_own" on public.finance_workspaces;
create policy "finance_workspaces_update_own" on public.finance_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "finance_workspaces_delete_own" on public.finance_workspaces;
create policy "finance_workspaces_delete_own" on public.finance_workspaces for delete to authenticated using ((select auth.uid()) = user_id);
