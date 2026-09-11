-- Forward-compatible migration: preserve existing photos and budget history.
-- generation_id is now an internal attempt token, not a provider job ID.
create or replace function public.reserve_grocery_image(p_user uuid, p_name text, p_cost numeric, p_limit numeric)
returns boolean language plpgsql security definer set search_path = public as $$
declare job public.grocery_image_jobs; spent numeric; budget_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if p_cost is null or p_limit is null or p_cost <= 0 or p_limit < p_cost then
    raise exception 'Image allowance reached. Set a monthly allowance in Groceries Preferences.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select * into job from grocery_image_jobs where user_id = p_user and name = p_name;
  if found and (job.url is not null or (job.status <> 'failed' and job.updated_at > now() - interval '2 minutes')) then return false; end if;
  insert into grocery_image_budgets(user_id, month) values(p_user, budget_month) on conflict do nothing;
  select reserved_usd into spent from grocery_image_budgets where user_id = p_user and month = budget_month for update;
  if spent + p_cost > p_limit then raise exception 'Monthly image allowance reached. Upload a photo or try next month.'; end if;
  update grocery_image_budgets set reserved_usd = reserved_usd + p_cost where user_id = p_user and month = budget_month;
  insert into grocery_image_jobs(user_id, name, generation_id) values(p_user, p_name, gen_random_uuid()::text)
    on conflict(user_id,name) do update set status = 'reserved', generation_id = gen_random_uuid()::text, url = null, updated_at = now();
  return true;
end;
$$;
revoke all on function public.reserve_grocery_image(uuid,text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.reserve_grocery_image(uuid,text,numeric,numeric) to service_role;
