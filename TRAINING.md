# Training tracker

Open **C Board → Training** (`/cboard/training`). Sign in with the existing Cboard account. Today shows the scheduled workout, readiness, recent strict-form records, walking, recovery and pending next-morning checks. Start Workout, adjust the prefilled reps/seconds/load if needed, and tap Complete Set. The rest timer starts automatically. Finish Session records completed, partial or skipped status; open Calendar/History to review it.

The four-day, two-week re-entry schedule is seeded on first successful cloud load. Friday–Sunday are recovery days. Where the supplied plan specifies only “3 sets” for core work, 10 reps is an editable starting placeholder. Handstand holds start at zero because actual hold time must be recorded; prescribed attempt ranges and practice minutes are displayed. The weekly schedule continues until edited; Phase 2 never activates automatically.

## Database setup

Apply `supabase/migrations/202609170001_training.sql` to the existing Supabase project before opening Training. Use the Supabase SQL editor, or run `supabase db push` in an authenticated, linked CLI environment after reviewing its migration list. This development session could not authenticate to the linked database, so the migration has **not** been applied remotely.

The new `training_workspaces` table stores a versioned aggregate per authenticated user. Its primary key indexes the user lookup. RLS permits only the owner to read, insert or update; anonymous access is denied. Plans, library, symptoms, settings and session snapshots are updated atomically. Optimistic revisions prevent silently overwriting another device's work. Existing tables and authentication are unchanged.

## Storage and recovery

- Every committed edit is validated and synchronously written to `cboard:training:v1:<user-id>` before the UI reports success. The cloud queue persists across reloads. Rest timers use timestamps, not interval tick counts.
- Sync retries on reconnect and every 30 seconds. A cloud failure leaves the local queue intact. First-time initialization requires cloud access to avoid replacing existing remote records with an empty seed.
- Conflicting devices do not merge automatically. Export the local JSON in Settings, then explicitly load the cloud copy. Exported backups can be inspected and restored after confirmation.
- JSON restore checks schema version, references, dates, ranges, types, URLs and payload size. Unknown versions are rejected rather than guessed. Version 1 is the initial schema; future migrations must transform and validate before replacing data.
- CSV contains set-level performance, technique, mistakes, pain checkpoints, rest, notes and video references. Formula-like spreadsheet cells are escaped. JSON includes all plan, recovery, walking and bodyweight data.
- Browser storage is account-scoped, not encrypted. Logging requires available browser storage. A 4 MB aggregate limit produces an explicit save error instead of silently losing records; keep regular exports. Clearing browser data before pending changes sync removes those local-only changes.
- Offline logging works while the app is loaded or its assets are browser-cached. There is no service worker guaranteeing a cold offline launch.

## Progression and safety

Suggestions require all prescribed sets (both unilateral sides), Clean technique, target RIR, top-range performance, and recorded pain during/after/next morning at 0–2. Increasing pain, pain at 3+, or repeated Failed technique flags review. Skills also require at least 80% successful balance attempts before suggesting longer holds. This threshold is a transparent app rule, not a clinical assessment.

Phase 1 rep/hold increases are available from week two. Confirming a suggestion changes future prescriptions only; each session/exercise suggestion can be applied once. Phase 2 uses two working sets for selected main-strength exercises. Wrist restrictions, weighted pull-up prerequisites and weighted-dip prerequisites are enforced at workout start and set logging. Safety settings record the user's assessment; they do not provide medical clearance.

PRs use Clean by default, optionally Acceptable. Recent records compare like-for-like side and load. Progress charts expose tables for keyboard/screen-reader users. Volume is logged set count and reps × external kg, not estimated bodyweight tonnage; assistance is labeled separately. Muscle set counts overlap for compound movements.

Video attachments are HTTP(S) links to existing videos; binary video hosting is not included. Technique-reference URLs are editable and initially blank. Bodyweight in Training is its own check-in history, independent of Weight Progress.

## Files

- `src/features/training/`: screens, shared controls/styles, typed models, seed data, progression/validation, persistence hook and focused tests.
- `src/services/trainingService.js`: authenticated Supabase load/save with optimistic revisions.
- `src/app/App.jsx`, `src/components/layout/AppNavigation.jsx`, `src/components/pages/AppBoard.jsx`: route and navigation.
- `supabase/migrations/202609170001_training.sql`: table, constraints, grants and RLS.
- `scripts/check-training-browser.mjs`, `scripts/check-training-sql.mjs`: isolated browser and PostgreSQL verification.

## Verification

Verified on 2026-09-17: **168/168 Node tests pass**, including 17 focused Training tests; the production build passes; Prettier checks and strict model type-checking pass; browser workflow and isolated PostgreSQL/RLS checks pass. Browser checks also cover next-morning symptom entry, confirmed progression, duplicate-progression prevention, cloud conflicts and cross-tab protection. The existing Vite large-chunk and mixed-import warnings remain; Training itself is lazy-loaded as a separate approximately 21 KB gzip JavaScript bundle. Live Supabase migration deployment was not verified because database authentication was unavailable.

No runtime dependencies were added. The existing repository has a build command and Node tests, but no configured formatter, lint or type-check scripts. Prettier and TypeScript were run from temporary QA tooling against the new feature and models.

```powershell
node --test
npm run build
# With optional QA tools installed outside the repository:
node <qa>/node_modules/prettier/bin/prettier.cjs --check src/features/training src/services/trainingService.js scripts/check-training-browser.mjs scripts/check-training-sql.mjs
node <qa>/node_modules/typescript/bin/tsc --noEmit --strict src/features/training/models.ts
$env:TRAINING_PGLITE_PATH='<qa>/node_modules/@electric-sql/pglite'
node scripts/check-training-sql.mjs
```

Browser checks use the real app with all Supabase requests intercepted and a synthetic test account. Start a dedicated Vite server (these test values must never be used in deployment):

```powershell
$env:VITE_SUPABASE_URL='https://training-qa.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='training-test-key'
node node_modules/vite/bin/vite.js --host=127.0.0.1 --port=5178
# In a second terminal:
$env:TRAINING_PLAYWRIGHT_PATH='<qa>/node_modules/@playwright/test'
node scripts/check-training-browser.mjs
```

The test uses installed Microsoft Edge headlessly. It checks first-use, logging under ten seconds, undo, timer/refresh recovery, pause, finishing, history, progress, plan/library editing, export/invalid restore, offline replay, mobile overflow, both themes and the existing board. The SQL test executes the actual migration in disposable PGlite PostgreSQL and exercises owner isolation, schema constraints and stale-revision protection. Neither test accesses real user records.
