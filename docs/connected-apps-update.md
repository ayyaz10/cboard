# Connected apps update

Apply `supabase/migrations/202609300001_connected_apps.sql` before deploying the updated client. It adds `notes.app_key`, a unique per-user app-note index, the RLS-protected `diary_inventory_events` audit table, and two authenticated RPCs. Existing recipe, grocery and diary JSON rows are preserved; existing app notes are adopted lazily on their next append, and other legacy notes remain untouched.

Diary and grocery writes commit together with optimistic version checks. Each diary food retains its ingredient usage snapshot and resolved grocery ID. The grocery JSON gains `ingredientLinks`, `inventoryLedger`, `wishlist`, and `settings.stockTrackingPaused`; recipe ingredients gain stable IDs. Legacy IDs are deterministic and persist on the next ordinary save. No old diary history is deducted on load.

Only actual deductions are refundable. Paused activity is not caught up on resume. Deleting while paused leaves stock unchanged. Unknown stock remains unset; shortages can be negative so later corrections/deletions remain reversible. Unknown ingredient weights or incompatible units require review instead of guessed conversion. Ingredient links can be changed in Grocery for future logs; historical logs keep their stock IDs.

While automatic tracking is enabled, the recipe kitchen card directs consumption to Food Diary rather than offering a second stock deduction. Manual cooking deductions remain available when tracking is paused.

Notes append atomically to the same app document. Main Notes edits use optimistic version checks to avoid overwriting a concurrent append. App-note panels display the saved document and reuse the Notes rich-text editor. They refresh on Notes changes; concurrent updates preserve unsaved drafts and reject stale saves.

Verification:
- `npm run build` (this JavaScript project has no separate typecheck script).
- `node --test src/features/diary/*.test.js src/features/recipes/*.test.js src/features/groceries/*.test.js src/features/finance/*.test.js src/features/nutrition/*.test.js`
- `supabase/tests/connected_apps.sql` against an isolated PostgreSQL database, with two fixture auth users named in the test. It rolls back its test data.
- Browser component checks at desktop and 390px: manual-food autofocus, form placement, Save food moving into the list, selected food totals, all recipe nutrient inputs, and quantity/serving recalculation.

Applied migrations `202609300001_connected_apps.sql` and `202610010001_connected_apps_rpc_permissions.sql` to the live ControlBoard Supabase project (`oslhmrtxyjbjbhhrckky`) on 2026-10-01. The follow-up explicitly revokes anonymous RPC execution inherited from Supabase default privileges. Read-only live checks passed for both migration records, the app-note column and unique index, audit-table RLS and own-user read policy, authenticated read access, and both RPCs' authenticated-only execution and fixed search paths. Existing user data was preserved.

The updated frontend has not been deployed in this step. Live authenticated end-to-end saves still require a deployment smoke check.
