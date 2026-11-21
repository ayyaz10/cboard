begin;

-- RETURNS TABLE declares an output variable named id. A bare ON CONFLICT (id)
-- is ambiguous in PL/pgSQL, so both create RPCs name their primary-key constraints.
create or replace function public.create_user_task(
  p_id uuid, p_title text, p_description text default '',
  p_due_at timestamptz default null, p_priority text default 'normal'
)
returns table (
  id uuid, title text, description text, due_at timestamptz, priority text,
  completed_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  saved public.user_tasks%rowtype;
begin
  if actor is null then raise exception 'Sign in before saving a task.'; end if;
  if p_id is null or p_title is null or p_title is distinct from btrim(p_title)
    or char_length(p_title) not between 1 and 120
    or coalesce(char_length(p_description), 0) > 2000
    or p_priority not in ('low', 'normal', 'high') then
    raise exception 'Invalid task.';
  end if;

  insert into public.user_tasks (id, user_id, title, description, due_at, priority)
    values (p_id, actor, p_title, coalesce(p_description, ''), p_due_at, p_priority)
    on conflict on constraint user_tasks_pkey do nothing;

  select task.* into saved from public.user_tasks as task
    where task.id = p_id and task.user_id = actor;
  if not found or saved.deleted_at is not null then raise exception 'Task is unavailable.'; end if;
  if (saved.title, saved.description, saved.due_at, saved.priority)
    is distinct from (p_title, coalesce(p_description, ''), p_due_at, p_priority) then
    raise exception 'Task ID already belongs to different task details.';
  end if;

  return query select saved.id, saved.title, saved.description, saved.due_at,
    saved.priority, saved.completed_at, saved.created_at, saved.updated_at;
end;
$$;

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
  if not found or saved.deleted_at is not null then raise exception 'Reminder is unavailable.'; end if;
  if saved.title is distinct from p_title or saved.due_at is distinct from p_due_at then
    raise exception 'Reminder ID already belongs to different reminder details.';
  end if;

  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.created_at, saved.updated_at;
end;
$$;

revoke all on function public.create_user_task(uuid, text, text, timestamptz, text) from public, anon;
revoke all on function public.create_user_reminder(uuid, text, timestamptz) from public, anon;
grant execute on function public.create_user_task(uuid, text, text, timestamptz, text) to authenticated;
grant execute on function public.create_user_reminder(uuid, text, timestamptz) to authenticated;

commit;
