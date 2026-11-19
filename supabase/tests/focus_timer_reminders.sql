-- Run after migrations 202611190001 and 202611190002 in an isolated database
-- with these two auth.users fixtures. All test data rolls back.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
declare
  first_row record;
  retry_row record;
  occurrence record;
  duplicate_occurrence record;
  snoozed record;
  stale record;
  cancelled record;
  imported_again record;
  event_count integer;
  due_time timestamptz := now() - interval '155 seconds';
  rejected boolean := false;
begin
  select * into first_row from public.import_focus_timer_reminder(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Walk', due_time, 60000, 60000,
    'waiting', null, '{}'::jsonb
  );
  select * into retry_row from public.import_focus_timer_reminder(
    first_row.id, first_row.title, first_row.due_at, first_row.repeat_ms,
    first_row.duration_ms, first_row.status, first_row.alert_at, first_row.metadata
  );
  if retry_row.id is distinct from first_row.id or retry_row.revision <> first_row.revision then
    raise exception 'Retry duplicated or changed the imported record.';
  end if;
  begin
    perform * from public.apply_focus_timer_action(first_row.id, 'cancel', null, 'invalid-revision');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'A null expected revision was accepted.'; end if;

  select * into occurrence from public.begin_focus_timer_occurrence(first_row.id, due_time);
  select * into duplicate_occurrence from public.begin_focus_timer_occurrence(first_row.id, due_time);
  if not occurrence.applied or duplicate_occurrence.applied
    or occurrence.status <> 'ringing' or occurrence.alert_at <> due_time
    or occurrence.due_at <= now() then
    raise exception 'Concurrent repeat occurrence did not advance once on its original cadence.';
  end if;
  select count(*) into event_count from public.user_reminder_events
    where reminder_id = first_row.id and event_type = 'triggered';
  if event_count <> 1 then raise exception 'Duplicate shared trigger history was written.'; end if;

  select * into snoozed from public.apply_focus_timer_action(
    first_row.id, 'snooze', occurrence.revision, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:snoozed:1'
  );
  if not snoozed.applied or snoozed.status <> 'waiting' or snoozed.due_at <= now()
    or snoozed.alert_at is not null then raise exception 'Snooze did not update shared due time.'; end if;
  select * into stale from public.apply_focus_timer_action(
    first_row.id, 'cancel', occurrence.revision, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:cancelled:2'
  );
  if stale.applied or stale.revision <> snoozed.revision then raise exception 'Stale write overwrote a newer snooze.'; end if;

  select * into cancelled from public.apply_focus_timer_action(
    first_row.id, 'cancel', snoozed.revision, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:stopped:3'
  );
  select * into imported_again from public.import_focus_timer_reminder(
    first_row.id, first_row.title, first_row.due_at, first_row.repeat_ms,
    first_row.duration_ms, first_row.status, first_row.alert_at, first_row.metadata
  );
  if not cancelled.applied or imported_again.completed_at is null
    or imported_again.completed_at is distinct from cancelled.completed_at then
    raise exception 'A stale import resurrected a cancelled reminder.';
  end if;

end
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare
  row_count integer;
  rejected boolean := false;
begin
  select count(*) into row_count from public.list_focus_timer_reminders(
    now() - interval '1 day', now() + interval '1 year'
  );
  if row_count <> 0 then raise exception 'A second account can view another owner reminder.'; end if;
  begin
    perform * from public.apply_focus_timer_action(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cancel', 1, 'second-account-cancel'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'A second account changed another owner reminder.'; end if;
end
$$;
rollback;