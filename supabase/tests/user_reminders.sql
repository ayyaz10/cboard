-- Run after migrations 202611190001 and 202611200001 in an isolated database
-- with these two auth.users fixtures.
-- All checks execute as authenticated and the transaction rolls back its records.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
declare
  first_row record;
  retry_row record;
  completed_row record;
  completed_retry record;
  repeated_row record;
  rejected boolean := false;
begin
  select * into first_row from public.create_user_reminder(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Read from another device', '2026-11-19T09:30:00Z'
  );
  select * into retry_row from public.create_user_reminder(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Read from another device', '2026-11-19T09:30:00Z'
  );
  if first_row.id is distinct from retry_row.id or first_row.created_at is distinct from retry_row.created_at then
    raise exception 'Retry created a second reminder.';
  end if;

  begin
    perform * from public.create_user_reminder(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Conflicting content', '2026-11-19T09:30:00Z'
    );
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'Conflicting retry was accepted.'; end if;

  select * into completed_row from public.complete_user_reminder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  select * into completed_retry from public.create_user_reminder(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Read from another device', '2026-11-19T09:30:00Z'
  );
  select * into repeated_row from public.complete_user_reminder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if completed_row.completed_at is null
    or completed_retry.completed_at is distinct from completed_row.completed_at
    or repeated_row.completed_at is distinct from completed_row.completed_at then
    raise exception 'Repeated completion changed the original completion time.';
  end if;

  rejected := false;
  begin
    update public.user_reminders set user_id = '22222222-2222-4222-8222-222222222222'
      where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Owner reassignment was allowed.'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare
  visible_count integer;
  rejected boolean := false;
begin
  select count(*) into visible_count from public.list_user_reminders(
    '2026-11-19T00:00:00Z', '2026-11-20T00:00:00Z'
  );
  if visible_count <> 0 then raise exception 'Other user can read this reminder.'; end if;

  begin
    perform * from public.complete_user_reminder('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'Other user completed this reminder.'; end if;

  rejected := false;
  begin
    insert into public.user_reminders (id, user_id, title, due_at)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '11111111-1111-4111-8111-111111111111', 'Spoof owner', '2026-11-19T09:30:00Z');
  exception when insufficient_privilege or check_violation then rejected := true;
  end;
  if not rejected then raise exception 'Insert on behalf of another user was allowed.'; end if;
end
$$;

rollback;
