# Notes implementation audit

Audit and implementation date: 2026-11-06

## Baseline findings

- The Notes page loaded full note rows, including HTML and inline media, without pagination. Search in the tracker panel filtered loaded notes client-side; the main Notes page had no library search or lifecycle views.
- Notes shared one contenteditable rich-text editor across the Notes page, Progress Tracker, and workspace app notes. Persisted HTML was the canonical body; `content_text` was derived for preview/search. Attachments can also be embedded as data URLs, so they can make requests large.
- Main Notes required manual save. Normal delete physically removed a row. There was no archive, trash, or restore model.
- Updates used `updated_at` as an optimistic concurrency condition. User ownership was enforced by authenticated Supabase access and RLS. The new search RPC keeps `SECURITY INVOKER`, scopes to `auth.uid()`, and does not change RLS.
- The PWA intentionally does not cache private user data or queue offline writes. No offline note queue was added; failed edits are retained in a user-scoped `sessionStorage` draft in the current tab and can be retried.
- No representative note dataset or authenticated local Supabase instance was available for baseline payload/latency measurement or query-plan inspection.

## Implemented

- Replaced the main Notes view with a responsive library/editor, search, recent/created/title sorting, paginated 40-row summaries, detail-on-open, tracker links, and stable `/notes/:id` deep links. Search query, view, sort, list scroll, and selection are scoped to the signed-in user in session UI state.
- Added an additive migration for active/archive/trash lifecycle state, pre-trash state, pin timestamp, and an expression GIN full-text index. The `search_notes` RPC returns bounded summary/snippet rows and uses the current authenticated user's RLS visibility. Active, pinned, archive, and trash queries are separate; restore and lifecycle changes retain note content and tags.
- Added server-side limits for title length, rich-text body bytes, tag count/length, and attachment count/payload bytes. The trigger validates inserted or changed values and leaves untouched legacy values alone so unrelated metadata updates remain possible.
- Changed ordinary delete to move to Trash. Restore, confirmed permanent delete, confirmed Empty Trash, Archive/unarchive, and pin/unpin are available. Trash has an Undo action. Duplicate creates a new stable ID and preserves the original.
- Added debounced autosave with saved/pending/saving/error feedback, manual retry/save, optimistic `updated_at` checks, and idempotent create retry handling. Unsaved edits are preserved in tab-scoped drafts across reloads and surfaced for recovery. Account changes remount the library by user ID.
- Kept sanitized HTML as the canonical content. The service derives plain text for indexing and previews. Sanitization removes unsupported active content and event attributes, restricts URLs and styles, and adds safe link `rel` attributes. Plain-text paste uses `insertText`; rich paste is sanitized.
- Improved editor toolbar semantics and formatting state, accessible names, focus styles, keyboard formatting shortcuts, and Ctrl/Cmd+S save. Responsive CSS provides a split view on wide screens and a list/detail switch on narrow screens, horizontally scrollable formatting controls, semantic theme tokens, and reduced-motion handling.
- Progress Tracker loads linked notes only when the selected goal's Notes view is opened, and its delete UI now uses Trash.
- Added node:test coverage for search matching, lifecycle transitions, and safe URL protocols.

## Verification

- `node --test src/features/notebook/*.test.js src/services/backupService.test.js src/pwa/*.test.js`: passed (35 tests).
- `npm run verify:pwa`: passed; verified 83 public assets, icons, manifest, scope, and integrity hashes.
- `npm run build`: passed. Vite reports existing oversized chunks over 500 kB; no bundle-size baseline was established for this Notes change.
- `git diff --check`: passed; Git emitted line-ending normalization warnings for existing modified files.
- Applied the migration twice to a disposable local PostgreSQL 17 cluster with a minimal Notes/Auth fixture. The SQL compiled idempotently, the RPC returned marked snippets, the size trigger rejected oversized title/body writes, and a two-user RLS fixture verified each identity only received its own rows.
- On 50,000 synthetic rows with 500 matches, the expression GIN index was selected. This local warm-cache EXPLAIN run measured 472 ms without the index (parallel sequential scan) and 1.2 ms with it (bitmap index scan). This is query-plan evidence, not a representative production latency benchmark.
- The Supabase CLI environment could not start because the Docker engine pipe `//./pipe/docker_engine` is absent, and the browser access host reported unavailable. No production database or account was used.

## Outstanding validation

- Apply and validate the migration in a non-production Supabase environment, then verify Supabase-specific grants and RLS behavior. The migration has only been applied to a disposable local PostgreSQL fixture, not Supabase.
- Rollout should apply the additive migration before the updated frontend. If the frontend needs rollback, roll back the app while retaining the additive columns, function, and trigger; remove them only after archived/trash lifecycle state is intentionally migrated or exported.
- Measure response bytes, large-note editing, and 1k/10k-row library behavior against representative data before making production-scale performance claims. Pagination bounds returned rows; the expression index use was verified only against the synthetic fixture.
- Run manual keyboard and screen-reader checks and responsive viewport checks at the requested phone/tablet/desktop sizes. CSS and semantic behavior were reviewed, but browser-based validation was blocked.
- The existing shared editor still uses `document.execCommand`; checklist toggles are not implemented because the current editor has no checklist model. Offline queue/sync and persistent multi-version history remain outside the current storage architecture; drafts, trash recovery, and conflict preservation cover immediate recovery paths.

## Follow-up production-compatible diagnosis — 2026-11-07

- Read-only probes against the Supabase project configured for the app confirmed schema drift: selecting the existing base Notes columns succeeded, while selecting `lifecycle_state` returned PostgreSQL `42703` (`notes.lifecycle_state` does not exist). Calling the Notes page's `search_notes` RPC returned PostgREST `PGRST202` (`Could not find the function ... in the schema cache`). Together these establish that the lifecycle/search migration is not reflected by the live API schema; a stale RPC cache alone cannot account for the missing lifecycle column.
- The probes used only the browser-safe anon key and made no writes. The schema compatibility requests included the base table's content column names; no response payload was displayed or logged, and no note content was inspected. The lifecycle-column probe failed before returning rows. RLS policy definitions in the repository remain user-scoped; live RLS behavior was not tested because there was no authenticated database session.
- The required additive migration already exists at `supabase/migrations/202611060001_notes_lifecycle_search.sql`. It adds lifecycle fields with `active` defaults and creates the RPC/index/trigger without copying, deleting, or rewriting Notes. It has not been applied to the live project. `supabase migration list --linked` could not connect because the database password was unavailable, so remote migration tracking status could not be read. No production backup mechanism was verified, and no migration was applied.
- The Notes UI now classifies query/schema errors separately from network/auth/server errors, keeps a matching user-scoped cached list when refresh fails, suppresses the empty state after failures, retries the Notes request in place, and emits only operation/type/code/request ID/timing diagnostics. Pin/archive/trash controls remain hidden until the current Notes RPC succeeds. A recovered existing-note draft must revalidate its ID and `updated_at` against the authenticated server before autosave can run.
- The focused Notes suite passes (11 tests). The full repository `node --test` run reports 774 passing and one failure in the untouched nutrition test `src/features/nutrition/foodCatalog.test.js:101` (`catalogItemFromRecipeIngredient` returned null); this is outside Notes and was not changed here. The production build and PWA verification pass; Vite still reports the repository's large-chunk warning.
- Local regression coverage and build checks pass. The deployed page, authenticated existing-note integrity, live retry, RLS isolation, lifecycle transitions, and browser console/network trace remain unverified until the additive migration is applied through an authenticated, backed-up Supabase maintenance path and the updated frontend is deployed. Browser access host was unavailable; the open Chrome page was the local `localhost:5173` app.
