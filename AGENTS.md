# ControlBoard engineering rules

These rules apply across the repository. Keep changes compatible with the existing React/Vite app, Supabase data model, and established feature/service conventions.

## Before changing code

- Inspect the relevant feature, shared service, Supabase function, schema, and nearby tests before editing. Treat `README.md` and feature docs as the source for setup and behavior.
- State confirmed findings separately from assumptions. Trace requests to the UI action or lifecycle that triggers them before changing data-fetching behavior.
- Prefer a small root-cause fix. Preserve existing user-visible behavior and backwards compatibility; avoid speculative refactors and dependencies.

## Reliability and code quality

- Follow local JavaScript/JSX, CSS, and SQL conventions. Keep feature logic in `src/features/`, shared data access in `src/services/`, and server-only work in `supabase/functions/`.
- Represent loading, empty, error, and retry states where applicable. Do not silently swallow exceptions; handle, report safely, or rethrow them. Bound network timeouts and retries, and retry only operations that are safe to repeat.
- Add focused regression coverage for bug fixes using the repository's existing `node:test` style. Do not disable tests, suppress warnings, or loosen checks to make a change pass.
- Run relevant checks available in `package.json` (including `npm run build`, applicable test scripts, and `npm run verify:pwa`). There is no configured lint or type-check script; do not claim either was run unless one is added.

## Supabase, data, and performance

- Reuse `src/lib/supabaseClient.js` and the existing service layer. Avoid duplicate or unnecessary queries, API calls, and writes; skip updates when values are unchanged.
- Select only needed columns and rows. Paginate potentially large result sets, bound responses and retries, and do not add unbounded polling or automatic refresh. Clean up timers, subscriptions, and event listeners on teardown.
- Scope cached private data to the authenticated user. Invalidate it on logout, account switch, relevant mutations, or permission changes; never share private cached data across users.
- Consider Supabase PostgREST response bytes and egress when changing reads, payloads, pagination, caching, or refresh behavior. Support performance claims with before/after measurements; do not infer savings from query counts alone.
- Add indexes only for demonstrated query patterns after inspecting query plans and write costs. Keep SQL changes in the existing `supabase/migrations/` convention and keep schema, grants, and RLS policies consistent.

## Security and privacy

- Only the Supabase anon key may be used by browser code. Keep service-role keys, provider credentials, and other secrets in server-side Supabase Edge Function secrets; never put them in `VITE_` variables, logs, or reports.
- Derive identity from a verified server-side session and enforce authorization on the server. Use least privilege and RLS for user-owned data; include user scoping in privileged operations and test that one user cannot read or change another user's private data.
- Validate and bound untrusted input at trust boundaries. Review storage access, administrative operations, API responses, and logs for unintended access or sensitive data exposure. Do not weaken authentication, authorization, RLS, or other security controls to improve performance.

## Database and release changes

- Do not apply production migrations, change production RLS/grants/auth configuration, delete or rewrite production data, make destructive changes, or deploy without explicit user approval.
- Before requesting approval for a production-impacting change, provide the concrete migration or operation, verification plan, and rollback plan. Keep routine changes reviewable and document material tradeoffs and unverified assumptions.
