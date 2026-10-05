-- Backup replacement must be able to remove the authenticated user's prior workspace.
grant delete on public.training_workspaces to authenticated;

drop policy if exists "Delete own training" on public.training_workspaces;
create policy "Delete own training" on public.training_workspaces
  for delete to authenticated
  using ((select auth.uid()) = user_id);
