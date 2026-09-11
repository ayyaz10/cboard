# Groceries

Open **Groceries** in the app navigation. The feature uses the current signed-in account and the existing `user_tool_preferences` table (`groceries:v1`). No database migration is needed for inventory, shopping lists, uploaded photos, or recipe integration.

- Thirty starter items have **Set quantity**, never invented stock. Set quantities directly, press Enter, then use the +/− controls.
- **N** opens Quick Add; **/** focuses search. Paste one item per line and review parsed names, quantities, units, and categories before saving. Existing names restock the existing item.
- Select rows for bulk category changes, shopping additions, removal, and purchases. Shopping checkout confirms quantities and asks for existing stock when unknown.
- The latest stock change or removal can be undone. Failed saves restore the previous state. Version checks reject changes from stale tabs rather than overwriting newer account data.
- Recipe pages show a grocery checklist, serving/batch scaling, missing-item shopping additions, and a reviewed “Mark as cooked” deduction. Unknown amounts and incompatible units require correction. Recipe amounts without servings are treated as one batch.
- Units convert only within weight or volume. Count words such as “whole” and “medium” map to pieces. Packs never imply a weight. Changing an item's unit clears its quantity for explicit re-entry.
- Preferences control best-before labels and automatic photos for newly added items. Uploads accept JPG, PNG, and WebP. Failed generation keeps a category placeholder and can be retried from the item editor.
- Item photos use one shared image library inside the account's Supabase `groceries:v1` record. Uploading, generating, replacing, or removing a photo updates inventory rows, matching shopping-list entries, and recipe ingredient availability displays. Older item-level images migrate into the shared library when groceries load.

## Cloudflare FLUX.1 Schnell setup

Image generation requires deployment separately from this static Vite app. No API key belongs in `VITE_*` variables or frontend code.

1. In Cloudflare, open **Workers AI → Use REST API**. Create a Workers AI API token and copy your Account ID. Use the provided token template, or scope a custom token to your account with Workers AI Read and Edit permissions. See the [official setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).
2. In your app's Supabase project, open **Edge Functions → Secrets** and add:
   - `CLOUDFLARE_ACCOUNT_ID`: the 32-character Account ID, not a Zone ID.
   - `CLOUDFLARE_API_TOKEN`: the Workers AI token. Keep it server-side.
3. Apply both SQL migrations in order to the same Supabase project:
   - `supabase/migrations/202609090001_grocery_images.sql`
   - `supabase/migrations/202609090002_cloudflare_grocery_images.sql`
   The second migration preserves existing photos and budget history. If the first migration is already applied, apply only the second. RLS prevents clients from accessing jobs or budget records directly.
4. Deploy `supabase functions deploy grocery-image --project-ref YOUR_PROJECT_REF` after `supabase login`. The function verifies the caller with `auth.getUser()` before accessing account data. The existing static app calls this function; no separate Cloudflare Worker deployment is needed.
5. In **Groceries → Preferences**, set a monthly image allowance above zero (for example, `1`). Enable automatic photos for new items if desired. For an existing item, choose **Edit → More details & photo → Generate / retry image**.

The model is fixed to `@cf/black-forest-labs/flux-1-schnell` with four steps, using its default image dimensions. The prompt requests a colorful, friendly vector-style grocery icon with bold colors, clean shapes, a warm cream background, and no text or branding. Its supported input schema does not expose width/height controls. Cloudflare returns a JPEG in the REST response. The function validates and caches the image in the private job table, and the app saves a 256px WebP thumbnail in your grocery record. Images stay available without regenerating on page loads. See the [model documentation](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/).

### Allowance and retries

Cloudflare currently includes 10,000 Neurons per day on its Free and Paid Workers plans. Free-plan requests fail when the allocation is exhausted; paid-plan overages can incur charges. The allocation is shared with your other Workers AI usage. Check the [current pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

The app's allowance is a conservative request budget, not a Cloudflare billing statement. Each new attempt reserves `$0.01` by default, including requests covered by Cloudflare's free allowance and failed attempts. A `$1` app allowance therefore allows up to 100 attempts per UTC calendar month; it does not mean Cloudflare will charge $1. The function enforces the lower of the saved user allowance and an operator cap of `$1` per user/month.

Optional Edge Function secrets:

- `CLOUDFLARE_IMAGE_RESERVE_USD`: override the conservative per-attempt reservation (default `0.01`). Recheck Cloudflare pricing before changing it; the reservation must cover the fixed model request to bound actual spending.
- `CLOUDFLARE_MONTHLY_USER_CAP_USD`: override the operator cap (default `1`). A higher browser setting cannot bypass this cap.

An example is provided in `supabase/functions/.env.example`. Never use `VITE_*` for these credentials.

Requests are cached separately by model version, user, and normalized item name. Atomic PostgreSQL reservations prevent concurrent clicks from submitting multiple requests. A concurrent caller polls the private cache only, never Cloudflare. Failures and timeouts require an explicit retry; the retry reserves another attempt. Interrupted requests expire after two minutes. Attempt tokens prevent late responses from overwriting a newer request. Uploads take priority over a generated image that completes later.

## Verification

`node --test src/features/groceries/groceryData.test.js supabase/functions/grocery-image/handler.test.js` covers grocery operations plus the Cloudflare request/response contract, authentication, configuration, malformed responses, caching, concurrent requests, allowance enforcement, and explicit retries. Provider calls and database operations are mocked in these tests. `npm run build` checks the integrated production bundle.

Live Supabase persistence and Cloudflare generation require the configured account/project. The migrations and Edge Function are supplied as source; building the frontend does not deploy them.

Browser smoke checks used mocked account storage and image-service responses, covering inline edits, Undo, quick add, checkout, reload persistence, save failure recovery, image uploads/removal, missing-image fallback, mobile overflow, both themes, shortcuts, and recipe deductions/shopping amounts. Live provider billing and production database permissions were not exercised by those checks.

The Cloudflare switch was also checked in-browser with a mocked JPEG response: automatic thumbnail generation, no regeneration after reload, stock edits while generation is pending, preservation of a concurrently uploaded photo, and rate-limit fallback.
