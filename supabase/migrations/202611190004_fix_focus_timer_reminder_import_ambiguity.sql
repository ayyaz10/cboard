begin;

-- The RETURNS TABLE output column named `id` is a PL/pgSQL variable. Referencing
-- the conflict target as `(id)` is therefore ambiguous when this function runs.
-- Naming the primary-key constraint removes that ambiguity while preserving the
-- stable-ID, insert-only import contract.
create or replace function public.import_focus_timer_reminder(
  p_id uuid, p_title text, p_due_at timestamptz, p_repeat_ms bigint,
  p_duration_ms bigint, p_status text, p_alert_at timestamptz, p_metadata jsonb
)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  repeat_ms bigint, duration_ms bigint, status text, alert_at timestamptz,
  revision bigint, metadata jsonb, updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); saved public.user_reminders%rowtype;
begin
  if actor is null then raise exception 'Sign in before syncing reminders.'; end if;
  if p_id is null or p_title is null or p_title is distinct from btrim(p_title)
    or char_length(p_title) not between 1 and 120 or p_due_at is null
    or p_repeat_ms not between 0 and 608340000 or (p_repeat_ms <> 0 and p_repeat_ms < 60000)
    or p_duration_ms not between 0 and 315576000000
    or p_status not in ('waiting', 'ringing')
    or ((p_status = 'ringing') <> (p_alert_at is not null))
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or octet_length(p_metadata::text) > 2048 then
    raise exception 'Invalid focus timer reminder.';
  end if;

  insert into public.user_reminders
    (id, user_id, title, due_at, repeat_ms, duration_ms, status, alert_at, metadata)
  values (p_id, actor, p_title, p_due_at, p_repeat_ms, p_duration_ms, p_status, p_alert_at, p_metadata)
  on conflict on constraint user_reminders_pkey do nothing;

  select reminder.* into saved from public.user_reminders as reminder
    where reminder.id = p_id and reminder.user_id = actor;
  if not found then raise exception 'Reminder could not be imported.'; end if;
  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
    saved.revision, saved.metadata, saved.updated_at;
end;
$$;

revoke all on function public.import_focus_timer_reminder(uuid, text, timestamptz, bigint, bigint, text, timestamptz, jsonb) from public, anon;
grant execute on function public.import_focus_timer_reminder(uuid, text, timestamptz, bigint, bigint, text, timestamptz, jsonb) to authenticated;

commit;
