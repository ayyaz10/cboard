begin;

-- Focus Timer's one-off reminders can be scheduled well beyond a week (for
-- example, Finance payment-date reminders). Keep repeat cadence capped at a
-- week, but allow the original one-off duration to match the 10-year read
-- window used by the client.
alter table public.user_reminders
  drop constraint user_reminders_duration_ms_check,
  add constraint user_reminders_duration_ms_check
    check (duration_ms between 0 and 315576000000);

alter table public.user_reminder_events
  drop constraint user_reminder_events_duration_check,
  add constraint user_reminder_events_duration_check
    check (duration_ms between 0 and 315576000000);

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
      or coalesce((item->>'duration_ms')::bigint, -1) not between 0 and 315576000000
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

commit;
