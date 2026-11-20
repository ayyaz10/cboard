begin;

-- RETURNS TABLE exposes an output variable named `id`, which makes
-- ON CONFLICT (id) ambiguous inside this PL/pgSQL function. Name the primary
-- key constraint explicitly and keep the standalone reminder API unchanged.
create or replace function public.create_user_reminder(
  p_id uuid, p_title text, p_due_at timestamptz
)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare
  actor uuid := auth.uid();
  saved public.user_reminders%rowtype;
begin
  if actor is null then raise exception 'Sign in before saving a reminder.'; end if;
  if p_id is null or p_title is null or p_title is distinct from btrim(p_title)
    or char_length(p_title) not between 1 and 120 or p_due_at is null then
    raise exception 'Invalid reminder.';
  end if;

  insert into public.user_reminders (id, title, due_at)
    values (p_id, p_title, p_due_at)
    on conflict on constraint user_reminders_pkey do nothing;

  select reminder.* into saved from public.user_reminders as reminder
    where reminder.id = p_id and reminder.user_id = actor;
  if not found then raise exception 'Reminder could not be created.'; end if;
  if saved.title is distinct from p_title or saved.due_at is distinct from p_due_at then
    raise exception 'Reminder ID already belongs to different reminder details.';
  end if;

  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.created_at, saved.updated_at;
end;
$$;

revoke all on function public.create_user_reminder(uuid, text, timestamptz) from public, anon;
grant execute on function public.create_user_reminder(uuid, text, timestamptz) to authenticated;

commit;
