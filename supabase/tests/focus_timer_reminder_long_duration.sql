-- Run after migrations 202611190001, 202611190002 and 202611190003 in an
-- isolated database with the standard test auth.users fixtures. All data rolls back.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
declare
  item record;
  imported integer;
  reminder_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  due_time timestamptz := now() + interval '10 days';
begin
  select * into item from public.import_focus_timer_reminder(
    reminder_id, 'Payment reminder', due_time, 0, 864000000,
    'waiting', null, '{}'::jsonb
  );
  if item.duration_ms <> 864000000 then
    raise exception 'A 10-day one-off reminder did not preserve its duration.';
  end if;

  imported := public.import_focus_timer_history(jsonb_build_array(jsonb_build_object(
    'event_key', reminder_id::text || ':created:1',
    'reminder_id', reminder_id,
    'title', 'Payment reminder',
    'repeat_ms', 0,
    'duration_ms', 864000000,
    'due_at', due_time,
    'event_type', 'created',
    'occurred_at', now()
  )));
  if imported <> 1 then raise exception 'Long-duration reminder history did not import.'; end if;
end
$$;

rollback;
