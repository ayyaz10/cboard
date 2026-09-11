create table if not exists public.ai_action_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  usage_day date not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, action, usage_day)
);

alter table public.ai_action_usage enable row level security;
revoke all on public.ai_action_usage from anon, authenticated;

create or replace function public.reserve_recipe_parse()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  today_utc date := (now() at time zone 'UTC')::date;
  used integer;
begin
  if caller is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':parse-recipe', 0));
  insert into public.ai_action_usage(user_id, action, usage_day, count)
    values(caller, 'parse-recipe', today_utc, 0) on conflict do nothing;
  select count into used from public.ai_action_usage
    where user_id = caller and action = 'parse-recipe' and usage_day = today_utc for update;
  if used >= 30 then return false; end if;
  update public.ai_action_usage set count = count + 1, updated_at = now()
    where user_id = caller and action = 'parse-recipe' and usage_day = today_utc;
  return true;
end;
$$;

revoke all on function public.reserve_recipe_parse() from public, anon;
grant execute on function public.reserve_recipe_parse() to authenticated;
