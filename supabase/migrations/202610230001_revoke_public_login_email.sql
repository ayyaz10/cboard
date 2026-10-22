-- Username sign-in now resolves profile email only inside the username-login Edge Function.
-- Keep the function definition for schema compatibility, but remove all API-role access.
revoke all on function public.resolve_login_email(text) from public, anon, authenticated;
