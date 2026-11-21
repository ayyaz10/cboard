-- Run after 202611210001_unified_tasks.sql with these two auth.users fixtures.
-- All rows are created through authenticated RPCs and rolled back.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$
declare first_task record; retry_task record; done_task record; done_retry record; updated record; deleted_count integer; rejected boolean:=false;
begin
 select * into first_task from public.create_user_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Clean the car','',null,'normal');
 select * into retry_task from public.create_user_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Clean the car','',null,'normal');
 if first_task.id is distinct from retry_task.id or first_task.created_at is distinct from retry_task.created_at then raise exception 'Idempotent create produced a duplicate task.'; end if;
 select * into updated from public.update_user_task(first_task.id,first_task.updated_at,'Clean the car today','',null,'high');
 if not updated.applied or updated.title<>'Clean the car today' then raise exception 'Task update did not apply.'; end if;
 select * into retry_task from public.update_user_task(first_task.id,first_task.updated_at,'Stale edit','',null,'low');
 if retry_task.applied then raise exception 'Stale task edit overwrote a newer version.'; end if;
 select * into done_task from public.complete_user_task(first_task.id);
 select * into done_retry from public.complete_user_task(first_task.id);
 if done_task.completed_at is null or done_retry.completed_at is distinct from done_task.completed_at then raise exception 'Repeated task completion changed the completion timestamp.'; end if;
 perform public.delete_user_task(first_task.id,done_task.updated_at);
 select count(*) into deleted_count from public.list_user_tasks('2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',true);
 if deleted_count<>0 then raise exception 'Deleted task remains visible.'; end if;
 begin perform * from public.create_user_task(first_task.id,'Clean the car today','',null,'high'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Deleted task ID was resurrected by create retry.'; end if;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare visible_count integer; rejected boolean:=false;
begin
 select count(*) into visible_count from public.list_user_tasks('2026-01-01T00:00:00Z','2027-01-01T00:00:00Z',true);
 if visible_count<>0 then raise exception 'Other user can read this task.'; end if;
 begin perform * from public.complete_user_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Other user completed this task.'; end if;
 rejected:=false;
 begin perform public.delete_user_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Other user deleted this task.'; end if;
end $$;
rollback;
