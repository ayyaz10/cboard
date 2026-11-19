begin;

create table if not exists public.user_reminders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (title = btrim(title) and char_length(title) between 1 and 120),
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_reminders enable row level security;

create policy user_reminders_select_own on public.user_reminders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy user_reminders_insert_own on public.user_reminders
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy user_reminders_update_own on public.user_reminders
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_reminders from public, anon, authenticated;
grant select (id, user_id, title, due_at, completed_at, created_at, updated_at)
  on public.user_reminders to authenticated;
grant insert (id, title, due_at) on public.user_reminders to authenticated;
grant update (completed_at, updated_at) on public.user_reminders to authenticated;

create or replace function public.guard_user_reminder_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id
    or new.title is distinct from old.title or new.due_at is distinct from old.due_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Reminder identity and schedule cannot be changed.';
  end if;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'A completed reminder cannot be reopened.';
  end if;
  return new;
end;
$$;

create trigger user_reminders_guard_update
before update on public.user_reminders
for each row execute function public.guard_user_reminder_update();

create or replace function public.create_user_reminder(p_id uuid, p_title text, p_due_at timestamptz)
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
    on conflict (id) do nothing;

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

create or replace function public.list_user_reminders(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_after_due_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in before listing reminders.'; end if;
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at
    or ((p_after_due_at is null) <> (p_after_id is null))
    or (p_after_due_at is not null and (p_after_due_at < p_start_at or p_after_due_at >= p_end_at))
    or p_limit not between 1 and 100 then
    raise exception 'Invalid reminder date window or page cursor.';
  end if;

  return query
    select reminder.id, reminder.title, reminder.due_at, reminder.completed_at,
      reminder.created_at, reminder.updated_at
    from public.user_reminders as reminder
    where reminder.user_id = actor
      and reminder.due_at >= p_start_at
      and reminder.due_at < p_end_at
      and (p_after_due_at is null or (reminder.due_at, reminder.id) > (p_after_due_at, p_after_id))
    order by reminder.due_at asc, reminder.id asc
    limit p_limit + 1;
end;
$$;

create or replace function public.complete_user_reminder(p_id uuid)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in before completing a reminder.'; end if;
  if p_id is null then raise exception 'Invalid reminder.'; end if;

  return query
    update public.user_reminders as reminder
      set completed_at = coalesce(reminder.completed_at, now()),
          updated_at = case when reminder.completed_at is null then now() else reminder.updated_at end
      where reminder.id = p_id and reminder.user_id = actor
      returning reminder.id, reminder.title, reminder.due_at, reminder.completed_at,
        reminder.created_at, reminder.updated_at;
  if not found then raise exception 'Reminder is unavailable.'; end if;
end;
$$;

revoke all on function public.guard_user_reminder_update() from public, anon, authenticated;
revoke all on function public.create_user_reminder(uuid, text, timestamptz) from public, anon;
revoke all on function public.list_user_reminders(timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon;
revoke all on function public.complete_user_reminder(uuid) from public, anon;
grant execute on function public.create_user_reminder(uuid, text, timestamptz) to authenticated;
grant execute on function public.list_user_reminders(timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.complete_user_reminder(uuid) to authenticated;

commit;
