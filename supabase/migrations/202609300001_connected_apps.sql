-- Additive migration: existing JSON, notes and stock remain intact.
begin;
alter table public.notes add column if not exists app_key text;
create unique index if not exists notes_user_app_key on public.notes(user_id, app_key) where app_key is not null;

create table if not exists public.diary_inventory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  diary_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  previous_day jsonb, next_day jsonb, adjustments jsonb not null default '[]'::jsonb
);
alter table public.diary_inventory_events enable row level security;
grant select on public.diary_inventory_events to authenticated;
create policy diary_inventory_events_read_own on public.diary_inventory_events for select to authenticated using (user_id = auth.uid());
create index if not exists diary_inventory_events_user_date on public.diary_inventory_events(user_id, diary_date);

create or replace function public.commit_diary_inventory(
  p_date text, p_day jsonb, p_day_version timestamptz,
  p_grocery jsonb, p_grocery_version timestamptz, p_adjustments jsonb
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  old_day public.user_tool_preferences%rowtype;
  old_stock public.user_tool_preferences%rowtype;
  stamp timestamptz := clock_timestamp();
begin
  if actor is null then raise exception 'Sign in before saving.'; end if;
  if p_date !~ '^\d{4}-\d{2}-\d{2}$' or (p_day is not null and p_day->>'date' is distinct from p_date)
    or jsonb_typeof(p_grocery->'items') is distinct from 'array' then raise exception 'Invalid diary or stock data.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':diary-stock', 0));
  select * into old_stock from public.user_tool_preferences where user_id = actor and key = 'groceries:v1' for update;
  select * into old_day from public.user_tool_preferences where user_id = actor and key = 'food-diary:v1:' || p_date for update;
  if old_day.updated_at is distinct from p_day_version or old_stock.updated_at is distinct from p_grocery_version then
    raise exception 'Diary or groceries changed in another tab. Reload before saving. Your draft is still here.';
  end if;
  stamp := greatest(clock_timestamp(), coalesce(old_day.updated_at, stamp) + interval '1 microsecond', coalesce(old_stock.updated_at, stamp) + interval '1 microsecond');
  insert into public.user_tool_preferences(user_id,key,value,updated_at) values(actor,'groceries:v1',p_grocery,stamp)
    on conflict(user_id,key) do update set value=excluded.value, updated_at=excluded.updated_at;
  if p_day is null then
    delete from public.user_tool_preferences where user_id=actor and key='food-diary:v1:' || p_date;
  else
    insert into public.user_tool_preferences(user_id,key,value,updated_at) values(actor,'food-diary:v1:' || p_date,p_day,stamp)
      on conflict(user_id,key) do update set value=excluded.value, updated_at=excluded.updated_at;
  end if;
  insert into public.diary_inventory_events(user_id,diary_date,previous_day,next_day,adjustments)
    values(actor,p_date::date,old_day.value,p_day,coalesce(p_adjustments,'[]'::jsonb));
  return stamp;
end $$;
revoke all on function public.commit_diary_inventory(text,jsonb,timestamptz,jsonb,timestamptz,jsonb) from public;
grant execute on function public.commit_diary_inventory(text,jsonb,timestamptz,jsonb,timestamptz,jsonb) to authenticated;

-- Append under a row lock to the same Notes document, preserving edits and media.
create or replace function public.append_app_note(p_app text, p_title text, p_text text, p_html text)
returns uuid language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); note_id uuid;
begin
  if actor is null then raise exception 'Sign in before saving.'; end if;
  if p_app is null or p_text is null or p_html is null or p_title is null or length(p_app) > 200 or p_app not like '/%' or length(trim(p_text)) = 0 or length(p_text) > 14000 then raise exception 'Invalid app note.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':note:' || p_app, 0));
  -- Adopt one existing app note if available. Keep all other legacy documents intact.
  if not exists (select 1 from public.notes where user_id=actor and app_key=p_app) then
    update public.notes set app_key=p_app where id=(
      select id from public.notes where user_id=actor and app_key is null
        and (title=p_title or (tags ? left(p_title,length(p_title)-6) and title like left(p_title,length(p_title)-6) || ' ' || chr(183) || '%'))
      order by created_at,id limit 1
    );
  end if;
  insert into public.notes(user_id,app_key,title,content_text,content_html,tags)
    values(actor,p_app,p_title,p_text,p_html,jsonb_build_array(left(p_title,length(p_title)-6)))
  on conflict(user_id,app_key) where app_key is not null do update
    set content_text = notes.content_text || E'\n\n' || excluded.content_text,
        content_html = notes.content_html || excluded.content_html,
        updated_at = clock_timestamp()
  returning id into note_id;
  return note_id;
end $$;
revoke all on function public.append_app_note(text,text,text,text) from public;
grant execute on function public.append_app_note(text,text,text,text) to authenticated;
commit;
