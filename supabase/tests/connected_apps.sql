-- Run after schema and 202609300001 in an isolated database with two auth.users fixtures.
-- This test rolls back its own data.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
do $$
declare v timestamptz; n uuid; n2 uuid; failed boolean := false; count_before integer;
begin
  v := public.commit_diary_inventory('2026-09-29','{"date":"2026-09-29","meals":[]}',null,'{"items":[{"id":"stock","quantity":850}]}',null,'[{"itemId":"stock","amount":150}]');
  if not exists(select 1 from public.user_tool_preferences where key='food-diary:v1:2026-09-29' and updated_at=v) then raise exception 'Diary/version not saved'; end if;
  begin
    perform public.commit_diary_inventory('2026-09-29','{"date":"2026-09-29","meals":[]}',null,'{"items":[]}',null,'[]');
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Duplicate save was accepted'; end if;
  if (select count(*) from public.diary_inventory_events) <> 1 then raise exception 'Duplicate adjustment'; end if;
  failed := false;
  begin
    perform public.commit_diary_inventory('2026-09-29',null,v,'{"items":[]}',null,'[]');
  exception when others then failed := true;
  end;
  if not failed or not exists(select 1 from public.user_tool_preferences where key='food-diary:v1:2026-09-29') then raise exception 'Stale stock deleted diary'; end if;
  perform public.commit_diary_inventory('2026-09-29',null,v,'{"items":[{"id":"stock","quantity":1000}]}',v,'[{"itemId":"stock","amount":-150}]');
  if exists(select 1 from public.user_tool_preferences where key='food-diary:v1:2026-09-29') then raise exception 'Delete failed'; end if;
  if (select count(*) from public.diary_inventory_events) <> 2 then raise exception 'Missing audit event'; end if;
  insert into public.notes(user_id,title,content_text,content_html,tags) values(auth.uid(),'Grocery Notes','Legacy','<p>Legacy</p>','[]') returning id into n2;
  n := public.append_app_note('/groceries','Grocery Notes','First','<p>First</p>');
  if n <> n2 then raise exception 'Existing app note was not adopted'; end if;
  update public.notes set content_text='Edited in Notes', content_html='<p>Edited in Notes</p>' where id=n;
  n2 := public.append_app_note('/groceries','Grocery Notes','Second','<p>Second</p>');
  if n <> n2 then raise exception 'App note duplicated'; end if;
  if not exists(select 1 from public.notes where id=n and content_text=E'Edited in Notes\n\nSecond') then raise exception 'Notes edit overwritten'; end if;
  n2 := public.append_app_note('/finance','Finance Notes','Separate','<p>Separate</p>');
  if n = n2 then raise exception 'Different apps share note'; end if;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$ begin
  if exists(select 1 from public.diary_inventory_events) then raise exception 'Other user audit visible'; end if;
  perform public.append_app_note('/groceries','Grocery Notes','Other user','<p>Other user</p>');
  if (select count(*) from public.notes where app_key='/groceries') <> 1 then raise exception 'Notes user isolation failed'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.notes where app_key='/groceries') <> 2 then raise exception 'Cross-user note conflict'; end if;
end $$;
rollback;
