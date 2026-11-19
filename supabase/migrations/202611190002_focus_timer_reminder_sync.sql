begin;

-- Keep the standalone create/list/complete API intact. Focus Timer has additional
-- lifecycle fields and an append-only history stream shared by its open clients.
alter table public.user_reminders
  add column repeat_ms bigint not null default 0,
  add column duration_ms bigint not null default 0,
  add column status text not null default 'waiting',
  add column alert_at timestamptz,
  add column revision bigint not null default 1,
  add column metadata jsonb not null default '{}'::jsonb,
  add constraint user_reminders_repeat_ms_check
    check (repeat_ms = 0 or repeat_ms between 60000 and 608340000),
  add constraint user_reminders_duration_ms_check
    check (duration_ms between 0 and 608340000),
  add constraint user_reminders_status_check
    check (status in ('waiting', 'ringing', 'cancelled')),
  add constraint user_reminders_alert_at_check
    check ((status = 'ringing' and alert_at is not null) or (status <> 'ringing' and alert_at is null)),
  add constraint user_reminders_revision_check check (revision > 0),
  add constraint user_reminders_metadata_check
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048);

grant select (repeat_ms, duration_ms, status, alert_at, revision, metadata)
  on public.user_reminders to authenticated;

create table public.user_reminder_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_key text not null check (char_length(event_key) between 1 and 220),
  reminder_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  repeat_ms bigint not null default 0,
  duration_ms bigint not null default 0,
  due_at timestamptz not null,
  event_type text not null check (event_type in
    ('created', 'restored', 'triggered', 'snoozed', 'dismissed', 'cancelled', 'stopped')),
  occurred_at timestamptz not null default now(),
  constraint user_reminder_events_key_unique unique (user_id, event_key),
  constraint user_reminder_events_repeat_check
    check (repeat_ms = 0 or repeat_ms between 60000 and 608340000),
  constraint user_reminder_events_duration_check check (duration_ms between 0 and 608340000)
);

alter table public.user_reminder_events enable row level security;
create policy user_reminder_events_select_own on public.user_reminder_events
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.user_reminder_events from public, anon, authenticated;
grant select (event_id, user_id, event_key, reminder_id, title, repeat_ms, duration_ms, due_at, event_type, occurred_at)
  on public.user_reminder_events to authenticated;

-- Only immutable owner/id/title/creation fields are guarded here. Authenticated
-- clients still have no direct update grants for Focus Timer state; state changes
-- go through the ownership-checked RPCs below.
create or replace function public.guard_user_reminder_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id
    or new.title is distinct from old.title or new.created_at is distinct from old.created_at then
    raise exception 'Reminder identity cannot be changed.';
  end if;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'A completed reminder cannot be reopened.';
  end if;
  if new.revision < old.revision then raise exception 'Reminder revision cannot move backwards.'; end if;
  return new;
end;
$$;

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
    or p_duration_ms not between 0 and 608340000
    or p_status not in ('waiting', 'ringing')
    or ((p_status = 'ringing') <> (p_alert_at is not null))
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or octet_length(p_metadata::text) > 2048 then
    raise exception 'Invalid focus timer reminder.';
  end if;

  -- Stable local IDs make this safe to retry. On conflict, return the cloud
  -- version unchanged; an old device can never overwrite a newer edit/cancel.
  insert into public.user_reminders
    (id, user_id, title, due_at, repeat_ms, duration_ms, status, alert_at, metadata)
  values (p_id, actor, p_title, p_due_at, p_repeat_ms, p_duration_ms, p_status, p_alert_at, p_metadata)
  on conflict (id) do nothing;

  select reminder.* into saved from public.user_reminders as reminder
    where reminder.id = p_id and reminder.user_id = actor;
  if not found then raise exception 'Reminder could not be imported.'; end if;
  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
    saved.revision, saved.metadata, saved.updated_at;
end;
$$;

create or replace function public.list_focus_timer_reminders(
  p_start_at timestamptz, p_end_at timestamptz,
  p_after_due_at timestamptz default null, p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  repeat_ms bigint, duration_ms bigint, status text, alert_at timestamptz,
  revision bigint, metadata jsonb, updated_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in before listing reminders.'; end if;
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at
    or ((p_after_due_at is null) <> (p_after_id is null))
    or (p_after_due_at is not null and p_after_due_at >= p_end_at)
    or p_limit not between 1 and 100 then
    raise exception 'Invalid reminder date window or page cursor.';
  end if;
  return query select reminder.id, reminder.title, reminder.due_at, reminder.completed_at,
      reminder.repeat_ms, reminder.duration_ms, reminder.status, reminder.alert_at,
      reminder.revision, reminder.metadata, reminder.updated_at
    from public.user_reminders as reminder
    where reminder.user_id = actor and reminder.completed_at is null and reminder.due_at < p_end_at
      and (p_after_due_at is null or (reminder.due_at, reminder.id) > (p_after_due_at, p_after_id))
    order by reminder.due_at, reminder.id limit p_limit + 1;
end;
$$;

create or replace function public.list_focus_timer_history(
  p_start_at timestamptz, p_after_at timestamptz default null,
  p_after_id uuid default null, p_limit integer default 50
)
returns table (
  event_id uuid, event_key text, reminder_id uuid, title text, repeat_ms bigint,
  duration_ms bigint, due_at timestamptz, event_type text, occurred_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in before listing reminder history.'; end if;
  if p_start_at is null or ((p_after_at is null) <> (p_after_id is null))
    or p_limit not between 1 and 100 then raise exception 'Invalid reminder history cursor.'; end if;
  return query select event.event_id, event.event_key, event.reminder_id, event.title,
      event.repeat_ms, event.duration_ms, event.due_at, event.event_type, event.occurred_at
    from public.user_reminder_events as event
    where event.user_id = actor and event.occurred_at >= p_start_at
      and (p_after_at is null or (event.occurred_at, event.event_id) > (p_after_at, p_after_id))
    order by event.occurred_at, event.event_id limit p_limit + 1;
end;
$$;

create or replace function public.import_focus_timer_history(p_events jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); item jsonb; inserted_count integer := 0; wrote integer;
begin
  if actor is null then raise exception 'Sign in before syncing reminder history.'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then
    raise exception 'Invalid reminder history batch.';
  end if;
  for item in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(length(item->>'event_key'), 0) not between 1 and 220
      or coalesce(length(item->>'reminder_id'), 0) > 36
      or coalesce(length(item->>'title'), 0) not between 1 and 120
      or coalesce(item->>'event_type', '') not in ('created', 'restored', 'triggered', 'snoozed', 'dismissed', 'cancelled', 'stopped')
      or coalesce((item->>'repeat_ms')::bigint, -1) not between 0 and 608340000
      or coalesce((item->>'duration_ms')::bigint, -1) not between 0 and 608340000
      or coalesce(length(item->>'due_at'), 0) = 0 or coalesce(length(item->>'occurred_at'), 0) = 0 then
      raise exception 'Invalid reminder history event.';
    end if;
    insert into public.user_reminder_events
      (user_id, event_key, reminder_id, title, repeat_ms, duration_ms, due_at, event_type, occurred_at)
    values (actor, item->>'event_key', (item->>'reminder_id')::uuid, item->>'title',
      (item->>'repeat_ms')::bigint, (item->>'duration_ms')::bigint,
      (item->>'due_at')::timestamptz, item->>'event_type', (item->>'occurred_at')::timestamptz)
    on conflict (user_id, event_key) do nothing;
    get diagnostics wrote = row_count;
    inserted_count := inserted_count + wrote;
  end loop;
  return inserted_count;
end;
$$;

create or replace function public.begin_focus_timer_occurrence(p_id uuid, p_expected_due_at timestamptz)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  repeat_ms bigint, duration_ms bigint, status text, alert_at timestamptz,
  revision bigint, metadata jsonb, updated_at timestamptz, applied boolean
)
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); saved public.user_reminders%rowtype; scheduled timestamptz;
  next_due timestamptz; next_revision bigint;
begin
  if actor is null then raise exception 'Sign in before starting a reminder.'; end if;
  select reminder.* into saved from public.user_reminders as reminder
    where reminder.id = p_id and reminder.user_id = actor for update;
  if not found then raise exception 'Reminder is unavailable.'; end if;
  if saved.completed_at is not null
    or not (saved.status = 'waiting' or (saved.status = 'ringing' and saved.repeat_ms > 0))
    or saved.due_at is distinct from p_expected_due_at or saved.due_at > now() then
    return query select saved.id, saved.title, saved.due_at, saved.completed_at,
      saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
      saved.revision, saved.metadata, saved.updated_at, false;
    return;
  end if;

  scheduled := saved.due_at;
  next_due := scheduled;
  if saved.repeat_ms > 0 then
    next_due := scheduled + (saved.repeat_ms *
      (floor(extract(epoch from (now() - scheduled)) * 1000 / saved.repeat_ms)::bigint + 1)) * interval '1 millisecond';
  end if;
  next_revision := saved.revision + 1;
  update public.user_reminders as reminder set status = 'ringing', alert_at = scheduled,
      due_at = next_due, revision = next_revision, updated_at = now()
    where reminder.id = p_id and reminder.user_id = actor returning reminder.* into saved;
  insert into public.user_reminder_events
    (user_id, event_key, reminder_id, title, repeat_ms, duration_ms, due_at, event_type, occurred_at)
  values (actor, 'trigger:' || p_id::text || ':' || round(extract(epoch from scheduled)::numeric * 1000)::bigint,
      p_id, saved.title, saved.repeat_ms, saved.duration_ms, scheduled, 'triggered', now())
  on conflict (user_id, event_key) do nothing;
  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
    saved.revision, saved.metadata, saved.updated_at, true;
end;
$$;

create or replace function public.apply_focus_timer_action(
  p_id uuid, p_action text, p_expected_revision bigint, p_event_key text
)
returns table (
  id uuid, title text, due_at timestamptz, completed_at timestamptz,
  repeat_ms bigint, duration_ms bigint, status text, alert_at timestamptz,
  revision bigint, metadata jsonb, updated_at timestamptz, applied boolean
)
language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); saved public.user_reminders%rowtype; previous_due timestamptz;
  previous_alert timestamptz; result_status text; next_due timestamptz;
begin
  if actor is null then raise exception 'Sign in before updating a reminder.'; end if;
  if p_action is null or p_action not in ('snooze', 'dismiss', 'cancel')
    or p_expected_revision is null or p_expected_revision < 1
    or p_event_key is null or length(p_event_key) not between 1 and 220 then
    raise exception 'Invalid reminder action.';
  end if;
  select reminder.* into saved from public.user_reminders as reminder
    where reminder.id = p_id and reminder.user_id = actor for update;
  if not found then raise exception 'Reminder is unavailable.'; end if;
  if exists (select 1 from public.user_reminder_events event
      where event.user_id = actor and event.event_key = p_event_key
        and (event.reminder_id <> p_id or event.event_type <> case
          when p_action = 'cancel' and saved.repeat_ms > 0 then 'stopped'
          when p_action = 'cancel' then 'cancelled' when p_action = 'dismiss' then 'dismissed'
          else 'snoozed' end)) then
    raise exception 'Reminder action key was already used.';
  end if;
  if exists (select 1 from public.user_reminder_events event
      where event.user_id = actor and event.event_key = p_event_key
        and event.reminder_id = p_id
        and event.event_type = case when p_action = 'cancel' and saved.repeat_ms > 0 then 'stopped'
          when p_action = 'cancel' then 'cancelled' when p_action = 'dismiss' then 'dismissed'
          else 'snoozed' end) then
    return query select saved.id, saved.title, saved.due_at, saved.completed_at,
      saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
      saved.revision, saved.metadata, saved.updated_at, true;
    return;
  end if;
  if saved.completed_at is not null or saved.revision <> p_expected_revision
    or (p_action in ('snooze', 'dismiss') and saved.status <> 'ringing') then
    return query select saved.id, saved.title, saved.due_at, saved.completed_at,
      saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
      saved.revision, saved.metadata, saved.updated_at, false;
    return;
  end if;

  previous_due := saved.due_at;
  previous_alert := saved.alert_at;
  result_status := saved.status;
  if p_action = 'snooze' then
    update public.user_reminders as reminder set due_at = now() + interval '5 minutes',
      status = 'waiting', alert_at = null, revision = reminder.revision + 1, updated_at = now()
      where reminder.id = p_id and reminder.user_id = actor returning reminder.* into saved;
  elsif p_action = 'cancel' or saved.repeat_ms = 0 then
    result_status := case when p_action = 'cancel' and saved.repeat_ms > 0 then 'stopped'::text
      when p_action = 'cancel' then 'cancelled'::text else 'dismissed'::text end;
    update public.user_reminders as reminder set completed_at = now(), status = 'cancelled',
      alert_at = null, revision = reminder.revision + 1, updated_at = now()
      where reminder.id = p_id and reminder.user_id = actor returning reminder.* into saved;
  else
    update public.user_reminders as reminder set status = 'waiting', alert_at = null,
      revision = reminder.revision + 1, updated_at = now()
      where reminder.id = p_id and reminder.user_id = actor returning reminder.* into saved;
    result_status := 'dismissed';
  end if;

  insert into public.user_reminder_events
    (user_id, event_key, reminder_id, title, repeat_ms, duration_ms, due_at, event_type, occurred_at)
  values (actor, p_event_key, p_id, saved.title, saved.repeat_ms, saved.duration_ms,
    coalesce(previous_alert, previous_due), result_status, now())
  on conflict (user_id, event_key) do nothing;
  return query select saved.id, saved.title, saved.due_at, saved.completed_at,
    saved.repeat_ms, saved.duration_ms, saved.status, saved.alert_at,
    saved.revision, saved.metadata, saved.updated_at, true;
end;
$$;

revoke all on function public.import_focus_timer_reminder(uuid, text, timestamptz, bigint, bigint, text, timestamptz, jsonb) from public, anon;
revoke all on function public.list_focus_timer_reminders(timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon;
revoke all on function public.list_focus_timer_history(timestamptz, timestamptz, uuid, integer) from public, anon;
revoke all on function public.import_focus_timer_history(jsonb) from public, anon;
revoke all on function public.begin_focus_timer_occurrence(uuid, timestamptz) from public, anon;
revoke all on function public.apply_focus_timer_action(uuid, text, bigint, text) from public, anon;
grant execute on function public.import_focus_timer_reminder(uuid, text, timestamptz, bigint, bigint, text, timestamptz, jsonb) to authenticated;
grant execute on function public.list_focus_timer_reminders(timestamptz, timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.list_focus_timer_history(timestamptz, timestamptz, uuid, integer) to authenticated;
grant execute on function public.import_focus_timer_history(jsonb) to authenticated;
grant execute on function public.begin_focus_timer_occurrence(uuid, timestamptz) to authenticated;
grant execute on function public.apply_focus_timer_action(uuid, text, bigint, text) to authenticated;

-- Realtime makes other open Focus Timer screens refresh immediately. Focus/visibility
-- refreshes remain the fallback when a client reconnects or missed a change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_reminders') then
      alter publication supabase_realtime add table public.user_reminders;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_reminder_events') then
      alter publication supabase_realtime add table public.user_reminder_events;
    end if;
  end if;
end;
$$;

commit;
