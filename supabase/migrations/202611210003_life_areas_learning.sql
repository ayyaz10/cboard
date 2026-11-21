begin;

create table public.life_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  icon text not null default '✨' check (char_length(icon) between 1 and 16),
  color text not null default '#8b5cf6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.life_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  item_type text not null check (item_type in ('project', 'skill')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  target_date date,
  linked_goal_id uuid references public.goals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (area_id, user_id) references public.life_areas(id, user_id) on delete cascade
);

create table public.life_item_tasks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  life_item_id uuid not null,
  task_id uuid not null unique references public.user_tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (life_item_id, task_id),
  foreign key (life_item_id, user_id) references public.life_items(id, user_id) on delete cascade
);

create table public.life_item_notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  life_item_id uuid not null,
  note_id uuid primary key references public.notes(id) on delete cascade,
  source_type text not null default 'other' check (source_type in ('youtube', 'article', 'book', 'course', 'other')),
  source_url text not null default '' check (char_length(source_url) <= 2048),
  youtube_seconds integer check (youtube_seconds is null or youtube_seconds between 0 and 360000),
  key_takeaways text not null default '' check (char_length(key_takeaways) <= 5000),
  observations text not null default '' check (char_length(observations) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (life_item_id, user_id) references public.life_items(id, user_id) on delete cascade
);

alter table public.life_areas enable row level security;
alter table public.life_items enable row level security;
alter table public.life_item_tasks enable row level security;
alter table public.life_item_notes enable row level security;

create policy life_areas_select_own on public.life_areas for select to authenticated using (user_id = (select auth.uid()));
create policy life_areas_insert_own on public.life_areas for insert to authenticated with check (user_id = (select auth.uid()));
create policy life_areas_update_own on public.life_areas for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy life_items_select_own on public.life_items for select to authenticated using (user_id = (select auth.uid()));
create policy life_items_insert_own on public.life_items for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.life_areas a where a.id = area_id and a.user_id = (select auth.uid()))
  and (linked_goal_id is null or exists (select 1 from public.goals g where g.id = linked_goal_id and g.user_id = (select auth.uid())))
);
create policy life_items_update_own on public.life_items for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (select 1 from public.life_areas a where a.id = area_id and a.user_id = (select auth.uid()))
  and (linked_goal_id is null or exists (select 1 from public.goals g where g.id = linked_goal_id and g.user_id = (select auth.uid())))
);
create policy life_item_tasks_select_own on public.life_item_tasks for select to authenticated using (user_id = (select auth.uid()));
create policy life_item_tasks_insert_own on public.life_item_tasks for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.life_items i where i.id = life_item_id and i.user_id = (select auth.uid()))
  and exists (select 1 from public.user_tasks t where t.id = task_id and t.user_id = (select auth.uid()) and t.deleted_at is null)
);
create policy life_item_tasks_delete_own on public.life_item_tasks for delete to authenticated using (user_id = (select auth.uid()));
create policy life_item_notes_select_own on public.life_item_notes for select to authenticated using (user_id = (select auth.uid()));
create policy life_item_notes_insert_own on public.life_item_notes for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.life_items i where i.id = life_item_id and i.user_id = (select auth.uid()))
  and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
);
create policy life_item_notes_update_own on public.life_item_notes for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.life_items i where i.id = life_item_id and i.user_id = (select auth.uid()))
  and exists (select 1 from public.notes n where n.id = note_id and n.user_id = (select auth.uid()))
);
create policy life_item_notes_delete_own on public.life_item_notes for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update on public.life_areas to authenticated;
grant select, insert, update on public.life_items to authenticated;
grant select, insert, delete on public.life_item_tasks to authenticated;
grant select, insert, update, delete on public.life_item_notes to authenticated;

create or replace function public.list_life_areas_overview()
returns table(area_id uuid, area_name text, area_icon text, area_color text, item_id uuid, item_name text,
  item_type text, item_status text, target_date date, linked_goal_id uuid, linked_goal_title text,
  next_task_id uuid, next_task_title text, next_task_due_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select a.id, a.name, a.icon, a.color, i.id, i.name, i.item_type, i.status, i.target_date,
    g.id, g.title, next_task.id, next_task.title, next_task.due_at
  from public.life_areas a
  left join public.life_items i on i.area_id = a.id and i.user_id = auth.uid() and i.status = 'active'
  left join public.goals g on g.id = i.linked_goal_id and g.user_id = auth.uid()
  left join lateral (
    select t.id, t.title, t.due_at from public.life_item_tasks link
      join public.user_tasks t on t.id = link.task_id and t.user_id = auth.uid()
    where link.user_id = auth.uid() and link.life_item_id = i.id and t.deleted_at is null and t.completed_at is null
    order by t.due_at nulls last, t.created_at desc, t.id limit 1
  ) next_task on true
  where a.user_id = auth.uid() and a.archived_at is null
  order by a.sort_order, a.created_at, i.name nulls first
  limit 100;
$$;

create or replace function public.reorder_life_areas(p_ids uuid[])
returns boolean language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid(); affected integer;
begin
  if actor is null then raise exception 'Sign in before reordering life areas.'; end if;
  if p_ids is null or cardinality(p_ids) > 100 or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'Invalid life area order.';
  end if;
  if (select count(*) from public.life_areas a where a.user_id = actor and a.id = any(p_ids)) <> cardinality(p_ids) then
    raise exception 'One or more life areas are unavailable.';
  end if;
  update public.life_areas a set sort_order = ordering.position - 1, updated_at = now()
    from unnest(p_ids) with ordinality as ordering(id, position)
    where a.id = ordering.id and a.user_id = actor;
  get diagnostics affected = row_count;
  return affected = cardinality(p_ids);
end;
$$;

create or replace function public.link_life_item_task(p_life_item_id uuid, p_task_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid(); existing_item uuid;
begin
  if actor is null then raise exception 'Sign in before linking a task.'; end if;
  if not exists (select 1 from public.life_items i where i.id = p_life_item_id and i.user_id = actor)
    or not exists (select 1 from public.user_tasks t where t.id = p_task_id and t.user_id = actor and t.deleted_at is null) then
    raise exception 'The project or task is unavailable.';
  end if;
  select life_item_id into existing_item from public.life_item_tasks where task_id = p_task_id and user_id = actor;
  if found and existing_item <> p_life_item_id then raise exception 'This task is already linked to another project or skill.'; end if;
  insert into public.life_item_tasks(user_id, life_item_id, task_id) values(actor, p_life_item_id, p_task_id) on conflict (life_item_id, task_id) do nothing;
  return true;
end;
$$;

create or replace function public.list_life_item_tasks(p_life_item_id uuid, p_limit integer default 50)
returns table(id uuid, title text, description text, due_at timestamptz, priority text, completed_at timestamptz, updated_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select task.id, task.title, task.description, task.due_at, task.priority, task.completed_at, task.updated_at
  from public.life_item_tasks link join public.user_tasks task on task.id = link.task_id
  where link.user_id = auth.uid() and link.life_item_id = p_life_item_id and task.user_id = auth.uid() and task.deleted_at is null
  order by task.completed_at nulls first, task.due_at nulls last, task.created_at desc, task.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.save_life_learning_note(
  p_life_item_id uuid, p_note_id uuid, p_source_type text, p_source_url text,
  p_youtube_seconds integer, p_key_takeaways text, p_observations text, p_expected_updated_at timestamptz default null
)
returns timestamptz language plpgsql security invoker set search_path = public as $$
declare actor uuid := auth.uid(); saved_at timestamptz := now(); existing public.life_item_notes%rowtype;
begin
  if actor is null then raise exception 'Sign in before linking a learning note.'; end if;
  if p_source_type not in ('youtube','article','book','course','other') or char_length(coalesce(p_source_url,'')) > 2048
    or (p_youtube_seconds is not null and p_youtube_seconds not between 0 and 360000)
    or char_length(coalesce(p_key_takeaways,'')) > 5000 or char_length(coalesce(p_observations,'')) > 5000 then raise exception 'Invalid learning note details.'; end if;
  if p_source_url <> '' and p_source_url !~* '^https?://[^[:space:]]+$' then raise exception 'Source URL must use HTTP or HTTPS.'; end if;
  if not exists (select 1 from public.life_items i where i.id=p_life_item_id and i.user_id=actor)
    or not exists (select 1 from public.notes n where n.id=p_note_id and n.user_id=actor) then raise exception 'The project or note is unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_note_id::text, 0));
  select * into existing from public.life_item_notes where note_id=p_note_id and user_id=actor for update;
  if found then
    if p_expected_updated_at is null
      and existing.life_item_id=p_life_item_id and existing.source_type=p_source_type and existing.source_url=coalesce(p_source_url,'')
      and existing.youtube_seconds is not distinct from p_youtube_seconds
      and existing.key_takeaways=coalesce(p_key_takeaways,'') and existing.observations=coalesce(p_observations,'') then
      return existing.updated_at;
    end if;
    if existing.updated_at is distinct from p_expected_updated_at then raise exception 'This learning note changed elsewhere.'; end if;
    update public.life_item_notes l set life_item_id=p_life_item_id, source_type=p_source_type, source_url=coalesce(p_source_url,''),
      youtube_seconds=p_youtube_seconds, key_takeaways=coalesce(p_key_takeaways,''), observations=coalesce(p_observations,''), updated_at=saved_at
      where l.note_id=p_note_id and l.user_id=actor;
  else
    if p_expected_updated_at is not null then raise exception 'This learning note changed elsewhere.'; end if;
    insert into public.life_item_notes(user_id,life_item_id,note_id,source_type,source_url,youtube_seconds,key_takeaways,observations,updated_at)
      values(actor,p_life_item_id,p_note_id,p_source_type,coalesce(p_source_url,''),p_youtube_seconds,coalesce(p_key_takeaways,''),coalesce(p_observations,''),saved_at);
  end if;
  return saved_at;
end;
$$;

create or replace function public.list_life_item_notes(p_life_item_id uuid, p_limit integer default 20)
returns table(note_id uuid, title text, content_preview text, source_type text, source_url text, youtube_seconds integer,
  key_takeaways text, observations text, updated_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select note.id, note.title, left(note.content_text, 240), link.source_type, link.source_url, link.youtube_seconds,
    link.key_takeaways, link.observations, link.updated_at
  from public.life_item_notes link join public.notes note on note.id=link.note_id
  -- Older deployed Notes schemas predate the optional lifecycle migration.
  -- Notebook compatibility mode treats those rows as active; when the field
  -- exists, keep archived and trashed notes out of the Life Areas list.
  where link.user_id=auth.uid() and link.life_item_id=p_life_item_id and note.user_id=auth.uid()
    and coalesce(to_jsonb(note)->>'lifecycle_state', 'active')='active'
  order by link.updated_at desc, note.id desc limit least(greatest(coalesce(p_limit,20),1),50);
$$;

revoke all on function public.list_life_areas_overview() from public, anon;
grant execute on function public.list_life_areas_overview() to authenticated;
revoke all on function public.reorder_life_areas(uuid[]) from public, anon;
revoke all on function public.link_life_item_task(uuid,uuid) from public, anon;
revoke all on function public.list_life_item_tasks(uuid,integer) from public, anon;
revoke all on function public.save_life_learning_note(uuid,uuid,text,text,integer,text,text,timestamptz) from public, anon;
revoke all on function public.list_life_item_notes(uuid,integer) from public, anon;
grant execute on function public.reorder_life_areas(uuid[]) to authenticated;
grant execute on function public.link_life_item_task(uuid,uuid) to authenticated;
grant execute on function public.list_life_item_tasks(uuid,integer) to authenticated;
grant execute on function public.save_life_learning_note(uuid,uuid,text,text,integer,text,text,timestamptz) to authenticated;
grant execute on function public.list_life_item_notes(uuid,integer) to authenticated;

commit;
