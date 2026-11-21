-- Run after 202611210003_life_areas_learning.sql in an isolated database
-- with auth.users fixtures for both UUIDs below. All rows roll back.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;

do $$
declare created_task record; overview_count integer; visible_count integer; linked_note_at timestamptz;
begin
  insert into public.life_areas(id,user_id,name,description,icon,color)
    values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',auth.uid(),'Fitness','Practice','💪','#22c55e');
  insert into public.life_items(id,user_id,area_id,name,item_type,target_date)
    values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Handstands','skill',current_date+7);
  select * into created_task from public.create_user_task(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Practice handstands','',now()+interval '1 day','normal');
  if created_task.id is distinct from 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid then raise exception 'Task create failed.'; end if;
  if not public.link_life_item_task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',created_task.id) then raise exception 'Task link failed.'; end if;
  perform public.link_life_item_task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',created_task.id);
  select count(*) into overview_count from public.list_life_areas_overview()
    where area_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and item_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and next_task_id=created_task.id;
  if overview_count<>1 then raise exception 'Overview did not return its active task.'; end if;
  update public.life_areas set name='Fitness and Health' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select count(*) into visible_count from public.life_item_tasks where task_id=created_task.id;
  if visible_count<>1 then raise exception 'Retry duplicated the task link.'; end if;
  insert into public.notes(id,user_id,title,content_text)
    values('dddddddd-dddd-4ddd-8ddd-dddddddddddd',auth.uid(),'Handstand video notes','Practice balance.');
  linked_note_at := public.save_life_learning_note(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'youtube','https://youtu.be/example-video',272,'Practice wall-supported balance.','Form check.',null);
  if linked_note_at is null or (select count(*) from public.list_life_item_notes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') where note_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>1 then
    raise exception 'Learning note link was not visible to its owner.';
  end if;
  update public.life_areas set archived_at=now() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if not exists(select 1 from public.life_items where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') then raise exception 'Archiving removed a linked project.'; end if;
end $$;

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$
declare visible_count integer; rejected boolean:=false;
begin
  select count(*) into visible_count from public.life_areas where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if visible_count<>0 then raise exception 'Other user read a Life Area.'; end if;
  select count(*) into visible_count from public.list_life_areas_overview();
  if visible_count<>0 then raise exception 'Other user read the owner overview.'; end if;
  select count(*) into visible_count from public.life_items where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if visible_count<>0 then raise exception 'Other user read a Project or Skill.'; end if;
  select count(*) into visible_count from public.life_item_notes where note_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  if visible_count<>0 then raise exception 'Other user read a learning note link.'; end if;
  begin perform public.save_life_learning_note('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','youtube','https://youtu.be/example-video',272,'Practice wall-supported balance.','Form check.',null); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other user linked a foreign Notebook note.'; end if;
  rejected:=false;
  begin perform public.link_life_item_task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Other user linked an owner task.'; end if;
  update public.life_areas set name='Changed by attacker' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics visible_count = row_count;
  if visible_count<>0 then raise exception 'Other user changed a Life Area.'; end if;
end $$;
rollback;
