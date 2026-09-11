-- Only the Edge Function's service role can reserve image spend or modify jobs.
create table if not exists public.grocery_image_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'reserved',
  generation_id text,
  url text,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
create table if not exists public.grocery_image_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  reserved_usd numeric not null default 0,
  primary key (user_id, month)
);
alter table public.grocery_image_jobs enable row level security;
alter table public.grocery_image_budgets enable row level security;
revoke all on public.grocery_image_jobs, public.grocery_image_budgets from anon, authenticated;
grant all on public.grocery_image_jobs, public.grocery_image_budgets to service_role;

create or replace function public.reserve_grocery_image(p_user uuid, p_name text, p_cost numeric, p_limit numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare job public.grocery_image_jobs; spent numeric; budget_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if p_cost <= 0 or p_limit < p_cost then raise exception 'Image budget reached. Increase your monthly budget in Preferences.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into job from grocery_image_jobs where user_id = p_user and name = p_name;
  if found and job.status <> 'failed' then return false; end if;
  insert into grocery_image_budgets(user_id, month) values(p_user, budget_month) on conflict do nothing;
  select reserved_usd into spent from grocery_image_budgets where user_id = p_user and month = budget_month for update;
  if spent + p_cost > p_limit then raise exception 'Monthly image budget reached. Upload a photo or try next month.'; end if;
  update grocery_image_budgets set reserved_usd = reserved_usd + p_cost where user_id = p_user and month = budget_month;
  insert into grocery_image_jobs(user_id, name) values(p_user, p_name)
    on conflict(user_id,name) do update set status = 'reserved', generation_id = null, url = null, updated_at = now();
  return true;
end;
$$;
revoke all on function public.reserve_grocery_image(uuid,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.reserve_grocery_image(uuid,text,numeric,numeric) to service_role;
