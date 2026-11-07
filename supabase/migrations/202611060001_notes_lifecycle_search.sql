-- Additive Notes lifecycle and search fields. Existing note content is preserved.
alter table public.notes add column if not exists lifecycle_state text not null default 'active';
alter table public.notes add column if not exists state_before_trash text not null default 'active';
alter table public.notes add column if not exists pinned_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_lifecycle_state_check') then
    alter table public.notes add constraint notes_lifecycle_state_check
      check (lifecycle_state in ('active', 'archived', 'trashed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_state_before_trash_check') then
    alter table public.notes add constraint notes_state_before_trash_check
      check (state_before_trash in ('active', 'archived'));
  end if;
end $$;

create or replace function public.enforce_note_size_limits()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    if char_length(new.title) > 240 then
      raise exception using errcode = '22001', message = 'Note titles can be up to 240 characters.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.content_html is distinct from old.content_html then
    if octet_length(new.content_html) > 52428800 then
      raise exception using errcode = '22001', message = 'This note is too large to save (50 MB maximum).';
    end if;
  end if;
  if tg_op = 'INSERT' or new.content_text is distinct from old.content_text then
    if octet_length(new.content_text) > 5242880 then
      raise exception using errcode = '22001', message = 'This note contains too much searchable text (5 MB maximum).';
    end if;
  end if;
  if tg_op = 'INSERT' or new.tags is distinct from old.tags then
    if jsonb_typeof(new.tags) <> 'array' then
      raise exception using errcode = '22023', message = 'Tags must be a list.';
    end if;
    if jsonb_array_length(new.tags) > 12
      or exists (select 1 from jsonb_array_elements_text(new.tags) tag where char_length(tag) > 128) then
      raise exception using errcode = '22023', message = 'Use up to 12 tags, with 128 characters per tag.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.media is distinct from old.media then
    if jsonb_typeof(new.media) <> 'array' then
      raise exception using errcode = '22023', message = 'Attachments must be a list.';
    end if;
    if jsonb_array_length(new.media) > 24 or octet_length(new.media::text) > 47185920 then
      raise exception using errcode = '22023', message = 'Attachments in a note can total up to 32 MB.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_enforce_size_limits on public.notes;
create trigger notes_enforce_size_limits
before insert or update on public.notes
for each row execute function public.enforce_note_size_limits();
revoke all on function public.enforce_note_size_limits() from public, anon, authenticated;

create index if not exists notes_search_vector_idx on public.notes using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(tags::text, ''))
);

create or replace function public.search_notes(
  p_view text default 'active',
  p_query text default '',
  p_limit integer default 41,
  p_offset integer default 0,
  p_sort text default 'updated'
)
returns table (
  id uuid, user_id uuid, title text, content_preview text, content_snippet text,
  linked_goal_id uuid, app_key text, tags jsonb, lifecycle_state text,
  state_before_trash text, pinned_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language sql stable security invoker
set search_path = public
as $$
  select n.id, n.user_id, n.title, left(n.content_text, 240),
    case when nullif(trim(p_query), '') is null then left(n.content_text, 240)
      else ts_headline('simple', n.content_text, websearch_to_tsquery('simple', left(p_query, 160)),
        'StartSel=<<MATCH>>,StopSel=<<END>>,MaxWords=26,MinWords=8,ShortWord=2') end,
    n.linked_goal_id, n.app_key, n.tags, n.lifecycle_state, n.state_before_trash,
    n.pinned_at, n.created_at, n.updated_at
  from public.notes n
  where n.user_id = auth.uid()
    and (
      (p_view = 'active' and n.lifecycle_state = 'active')
      or (p_view = 'pinned' and n.lifecycle_state = 'active' and n.pinned_at is not null)
      or (p_view = 'archived' and n.lifecycle_state = 'archived')
      or (p_view = 'trash' and n.lifecycle_state = 'trashed')
    )
    and (
      nullif(trim(p_query), '') is null
      or to_tsvector('simple', coalesce(n.title, '') || ' ' || coalesce(n.content_text, '') || ' ' || coalesce(n.tags::text, ''))
        @@ websearch_to_tsquery('simple', left(p_query, 160))
    )
  order by
    case when p_view in ('active', 'pinned') then n.pinned_at end desc nulls last,
    case when p_sort = 'title' then lower(n.title) end asc,
    case when p_sort = 'created' then n.created_at end desc,
    case when p_sort not in ('title', 'created') then n.updated_at end desc,
    n.id desc
  limit least(greatest(coalesce(p_limit, 41), 1), 101)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.search_notes(text,text,integer,integer,text) from public, anon;
grant execute on function public.search_notes(text,text,integer,integer,text) to authenticated;
