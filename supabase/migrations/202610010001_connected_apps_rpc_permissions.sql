-- Supabase default privileges can grant anon execution explicitly.
-- These RPCs are reserved for authenticated callers.
begin;
revoke execute on function public.commit_diary_inventory(text,jsonb,timestamptz,jsonb,timestamptz,jsonb) from anon;
revoke execute on function public.append_app_note(text,text,text,text) from anon;
commit;
