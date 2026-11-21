begin;
create table public.user_tasks (
 id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 title text not null check(title=btrim(title) and char_length(title) between 1 and 120),
 description text not null default '' check(char_length(description)<=2000), due_at timestamptz,
 priority text not null default 'normal' check(priority in ('low','normal','high')),
 completed_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.user_tasks enable row level security;
create policy user_tasks_select_own on public.user_tasks for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.user_tasks from public,anon,authenticated;
grant select (id,user_id,title,description,due_at,priority,completed_at,deleted_at,created_at,updated_at) on public.user_tasks to authenticated;

create or replace function public.create_user_task(p_id uuid,p_title text,p_description text default '',p_due_at timestamptz default null,p_priority text default 'normal')
returns table(id uuid,title text,description text,due_at timestamptz,priority text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); saved public.user_tasks%rowtype;
begin
 if actor is null then raise exception 'Sign in before saving a task.'; end if;
 if p_id is null or p_title is null or p_title is distinct from btrim(p_title) or char_length(p_title) not between 1 and 120 or coalesce(char_length(p_description),0)>2000 or p_priority not in ('low','normal','high') then raise exception 'Invalid task.'; end if;
 insert into public.user_tasks(id,user_id,title,description,due_at,priority) values(p_id,actor,p_title,coalesce(p_description,''),p_due_at,p_priority) on conflict(id) do nothing;
 select t.* into saved from public.user_tasks t where t.id=p_id and t.user_id=actor;
 if not found or saved.deleted_at is not null then raise exception 'Task is unavailable.'; end if;
 if (saved.title,saved.description,saved.due_at,saved.priority) is distinct from (p_title,coalesce(p_description,''),p_due_at,p_priority) then raise exception 'Task ID already belongs to different task details.'; end if;
 return query select saved.id,saved.title,saved.description,saved.due_at,saved.priority,saved.completed_at,saved.created_at,saved.updated_at;
end; $$;

create or replace function public.list_user_tasks(p_start_at timestamptz,p_end_at timestamptz,p_include_undated boolean default false,p_after_due_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50)
returns table(id uuid,title text,description text,due_at timestamptz,priority text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before listing tasks.'; end if;
 if p_start_at is null or p_end_at is null or p_start_at>=p_end_at or (p_after_id is null and p_after_due_at is not null) or p_limit not between 1 and 100 then raise exception 'Invalid task window or cursor.'; end if;
 return query select t.id,t.title,t.description,t.due_at,t.priority,t.completed_at,t.created_at,t.updated_at from public.user_tasks t
 where t.user_id=actor and t.deleted_at is null and ((t.due_at>=p_start_at and t.due_at<p_end_at) or (p_include_undated and t.due_at is null))
 and (p_after_id is null or (p_after_due_at is null and t.due_at is null and t.id>p_after_id) or (p_after_due_at is not null and (t.due_at>p_after_due_at or (t.due_at=p_after_due_at and t.id>p_after_id) or t.due_at is null)))
 order by t.due_at asc nulls last,t.id asc limit p_limit+1;
end; $$;

create or replace function public.update_user_task(p_id uuid,p_expected_updated_at timestamptz,p_title text,p_description text,p_due_at timestamptz,p_priority text)
returns table(id uuid,title text,description text,due_at timestamptz,priority text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,applied boolean)
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); saved public.user_tasks%rowtype;
begin
 if actor is null then raise exception 'Sign in before updating a task.'; end if;
 if p_id is null or p_expected_updated_at is null or p_title is null or p_title is distinct from btrim(p_title) or char_length(p_title) not between 1 and 120 or coalesce(char_length(p_description),0)>2000 or p_priority not in ('low','normal','high') then raise exception 'Invalid task update.'; end if;
 select t.* into saved from public.user_tasks t where t.id=p_id and t.user_id=actor and t.deleted_at is null for update;
 if not found then raise exception 'Task is unavailable.'; end if;
 if saved.updated_at<>p_expected_updated_at then return query select saved.id,saved.title,saved.description,saved.due_at,saved.priority,saved.completed_at,saved.created_at,saved.updated_at,(saved.title,saved.description,saved.due_at,saved.priority) is not distinct from (p_title,coalesce(p_description,''),p_due_at,p_priority); return; end if;
 update public.user_tasks t set title=p_title,description=coalesce(p_description,''),due_at=p_due_at,priority=p_priority,updated_at=clock_timestamp() where t.id=p_id and t.user_id=actor returning t.* into saved;
 return query select saved.id,saved.title,saved.description,saved.due_at,saved.priority,saved.completed_at,saved.created_at,saved.updated_at,true;
end; $$;

create or replace function public.complete_user_task(p_id uuid)
returns table(id uuid,title text,description text,due_at timestamptz,priority text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); saved public.user_tasks%rowtype;
begin
 if actor is null then raise exception 'Sign in before completing a task.'; end if;
 update public.user_tasks t set completed_at=coalesce(t.completed_at,clock_timestamp()),updated_at=case when t.completed_at is null then clock_timestamp() else t.updated_at end where t.id=p_id and t.user_id=actor and t.deleted_at is null returning t.* into saved;
 if not found then raise exception 'Task is unavailable.'; end if;
 return query select saved.id,saved.title,saved.description,saved.due_at,saved.priority,saved.completed_at,saved.created_at,saved.updated_at;
end; $$;

create or replace function public.delete_user_task(p_id uuid,p_expected_updated_at timestamptz) returns boolean
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before deleting a task.'; end if;
 update public.user_tasks t set deleted_at=clock_timestamp(),updated_at=clock_timestamp() where t.id=p_id and t.user_id=actor and t.deleted_at is null and t.updated_at=p_expected_updated_at;
 if found then return true; end if;
 if exists(select 1 from public.user_tasks t where t.id=p_id and t.user_id=actor and t.deleted_at is not null) then return true; end if;
 raise exception 'Task changed on another device. Refresh and try again.';
end; $$;

revoke all on function public.create_user_task(uuid,text,text,timestamptz,text) from public,anon;
revoke all on function public.list_user_tasks(timestamptz,timestamptz,boolean,timestamptz,uuid,integer) from public,anon;
revoke all on function public.update_user_task(uuid,timestamptz,text,text,timestamptz,text) from public,anon;
revoke all on function public.complete_user_task(uuid) from public,anon;
revoke all on function public.delete_user_task(uuid,timestamptz) from public,anon;
grant execute on function public.create_user_task(uuid,text,text,timestamptz,text) to authenticated;
grant execute on function public.list_user_tasks(timestamptz,timestamptz,boolean,timestamptz,uuid,integer) to authenticated;
grant execute on function public.update_user_task(uuid,timestamptz,text,text,timestamptz,text) to authenticated;
grant execute on function public.complete_user_task(uuid) to authenticated;
grant execute on function public.delete_user_task(uuid,timestamptz) to authenticated;

alter table public.user_reminders add column deleted_at timestamptz;
create or replace function public.guard_user_reminder_update() returns trigger language plpgsql set search_path=public as $$
begin
 if new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Reminder identity cannot be changed.'; end if;
 if old.completed_at is not null and new.completed_at is distinct from old.completed_at then raise exception 'A completed reminder cannot be reopened.'; end if;
 if new.revision<old.revision then raise exception 'Reminder revision cannot move backwards.'; end if;
 return new;
end; $$;

grant select (deleted_at) on public.user_reminders to authenticated;
create or replace function public.create_user_reminder(p_id uuid,p_title text,p_due_at timestamptz)
returns table(id uuid,title text,due_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare actor uuid:=auth.uid(); saved public.user_reminders%rowtype;
begin
 if actor is null then raise exception 'Sign in before saving a reminder.'; end if;
 if p_id is null or p_title is null or p_title is distinct from btrim(p_title) or char_length(p_title) not between 1 and 120 or p_due_at is null then raise exception 'Invalid reminder.'; end if;
 insert into public.user_reminders(id,title,due_at) values(p_id,p_title,p_due_at) on conflict(id) do nothing;
 select r.* into saved from public.user_reminders r where r.id=p_id and r.user_id=actor;
 if not found or saved.deleted_at is not null then raise exception 'Reminder is unavailable.'; end if;
 if saved.title is distinct from p_title or saved.due_at is distinct from p_due_at then raise exception 'Reminder ID already belongs to different reminder details.'; end if;
 return query select saved.id,saved.title,saved.due_at,saved.completed_at,saved.created_at,saved.updated_at;
end; $$;
create or replace function public.list_user_reminders(p_start_at timestamptz,p_end_at timestamptz,p_after_due_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50)
returns table(id uuid,title text,due_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before listing reminders.'; end if;
 if p_start_at is null or p_end_at is null or p_start_at>=p_end_at or (p_after_id is null and p_after_due_at is not null) or p_limit not between 1 and 100 then raise exception 'Invalid reminder date window or page cursor.'; end if;
 return query select r.id,r.title,r.due_at,r.completed_at,r.created_at,r.updated_at from public.user_reminders r where r.user_id=actor and r.deleted_at is null and r.repeat_ms=0 and r.duration_ms=0 and r.due_at>=p_start_at and r.due_at<p_end_at and (p_after_due_at is null or (r.due_at,r.id)>(p_after_due_at,p_after_id)) order by r.due_at,r.id limit p_limit+1;
end; $$;

create or replace function public.complete_user_reminder(p_id uuid)
returns table(id uuid,title text,due_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before completing a reminder.'; end if;
 return query update public.user_reminders r set completed_at=coalesce(r.completed_at,now()),updated_at=case when r.completed_at is null then now() else r.updated_at end
  where r.id=p_id and r.user_id=actor and r.deleted_at is null
  returning r.id,r.title,r.due_at,r.completed_at,r.created_at,r.updated_at;
 if not found then raise exception 'Reminder is unavailable.'; end if;
end; $$;
create or replace function public.update_user_reminder(p_id uuid,p_expected_updated_at timestamptz,p_title text,p_due_at timestamptz)
returns table(id uuid,title text,due_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,applied boolean)
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); saved public.user_reminders%rowtype;
begin
 if actor is null then raise exception 'Sign in before updating a reminder.'; end if;
 if p_id is null or p_expected_updated_at is null or p_title is null or p_title is distinct from btrim(p_title) or char_length(p_title) not between 1 and 120 or p_due_at is null then raise exception 'Invalid reminder update.'; end if;
 select r.* into saved from public.user_reminders r where r.id=p_id and r.user_id=actor and r.deleted_at is null for update;
 if not found then raise exception 'Reminder is unavailable.'; end if;
 if saved.updated_at<>p_expected_updated_at then return query select saved.id,saved.title,saved.due_at,saved.completed_at,saved.created_at,saved.updated_at,(saved.title,saved.due_at) is not distinct from (p_title,p_due_at); return; end if;
 update public.user_reminders r set title=p_title,due_at=p_due_at,updated_at=clock_timestamp(),revision=r.revision+1 where r.id=p_id and r.user_id=actor returning r.* into saved;
 return query select saved.id,saved.title,saved.due_at,saved.completed_at,saved.created_at,saved.updated_at,true;
end; $$;

create or replace function public.delete_user_reminder(p_id uuid,p_expected_updated_at timestamptz) returns boolean
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before deleting a reminder.'; end if;
 update public.user_reminders r set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=r.revision+1 where r.id=p_id and r.user_id=actor and r.deleted_at is null and r.updated_at=p_expected_updated_at;
 if found then return true; end if;
 if exists(select 1 from public.user_reminders r where r.id=p_id and r.user_id=actor and r.deleted_at is not null) then return true; end if;
 raise exception 'Reminder changed on another device. Refresh and try again.';
end; $$;

revoke all on function public.update_user_reminder(uuid,timestamptz,text,timestamptz) from public,anon;
revoke all on function public.delete_user_reminder(uuid,timestamptz) from public,anon;
grant execute on function public.update_user_reminder(uuid,timestamptz,text,timestamptz) to authenticated;
grant execute on function public.delete_user_reminder(uuid,timestamptz) to authenticated;

-- Deleted standalone records must also disappear from the Focus Timer shared list.
create or replace function public.list_focus_timer_reminders(p_start_at timestamptz,p_end_at timestamptz,p_after_due_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50)
returns table(id uuid,title text,due_at timestamptz,completed_at timestamptz,repeat_ms bigint,duration_ms bigint,status text,alert_at timestamptz,revision bigint,metadata jsonb,updated_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in before listing reminders.'; end if;
 if p_start_at is null or p_end_at is null or p_start_at>=p_end_at or (p_after_id is null and p_after_due_at is not null) or p_limit not between 1 and 100 then raise exception 'Invalid reminder date window or page cursor.'; end if;
 return query select r.id,r.title,r.due_at,r.completed_at,r.repeat_ms,r.duration_ms,r.status,r.alert_at,r.revision,r.metadata,r.updated_at from public.user_reminders r where r.user_id=actor and r.deleted_at is null and (r.duration_ms>0 or r.repeat_ms>0) and r.completed_at is null and r.due_at<p_end_at and (p_after_due_at is null or (r.due_at,r.id)>(p_after_due_at,p_after_id)) order by r.due_at,r.id limit p_limit+1;
end; $$;
revoke all on function public.list_focus_timer_reminders(timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon;
grant execute on function public.list_focus_timer_reminders(timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_tasks') then alter publication supabase_realtime add table public.user_tasks; end if; end if; end; $$;
commit;
