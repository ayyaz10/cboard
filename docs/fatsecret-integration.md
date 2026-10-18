# FatSecret food provider

## CBoard audit

- Reusable foods live in the existing `food-catalog:v1` canonical catalog. Diary, recipe, meal planner, and grocery flows use this same catalog and preserve consumed nutrition snapshots.
- `NutritionLookup` opens on **My saved foods**. Existing sources are Open Food Facts through the authenticated nutrition Edge Function, plus local USDA and CoFID datasets. The FatSecret option is additive and does not delay local results.
- `FatSecretFoodProvider` isolates FatSecret requests. Search candidates and serving details stay in active UI memory. The FatSecret preview does not call `onSelect`, and the function writes no food/search data into CBoard storage. It is read-only for now; FatSecret results cannot be added to the Diary, Recipes, Grocery, or saved Foods.

## Authentication, endpoints and limits

- Calls run in the authenticated `fatsecret-foods` Supabase Edge Function. Client credentials are never exposed to the browser. OAuth uses `https://oauth.fatsecret.com/connect/token`, client credentials grant, and a cached server-side bearer token.
- For `FATSECRET_SCOPE=basic`, the function uses the method-based `POST /rest/server.api` route shown in FatSecret's [OAuth guide](https://platform.fatsecret.com/docs/guides/authentication/oauth2): `foods.search`, then `food.get` on demand. For Premier scope it uses current v5 paths. FatSecret's generic OAuth guide demonstrates Basic food search, while the endpoint-specific path docs label newer search methods Premier; the Free Plan key must be verified against the live Basic endpoint.
- Search returns candidate names/types/descriptions. Serving choices and mapped nutrients load only when a candidate is opened. Missing nutrients remain unknown. Attribution is visible in the picker.
- The Free Plan dashboard reports 5,000 calls/day and US-only data. The function rate-limits per Edge Function instance; monitor the FatSecret account quota across instances. API results are not cached server-side and responses use `no-store`.

## Storage and current behavior

FatSecret's current [Storable Data documentation](https://platform.fatsecret.com/docs/guides/storable-data) permits indefinite storage of `food_id` and `serving_id`; other returned data may not be cached for more than 24 hours. CBoard's canonical Food, Diary, Recipe, and Grocery flows save long-lived nutrition snapshots. The preview-only design avoids that conflict: FatSecret details remain in active UI memory and cannot be saved through the current picker.

Configure `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, and `FATSECRET_SCOPE=basic` as Supabase Edge Function secrets only, using the template `supabase/functions/.env.example`. Deploy `fatsecret-foods`. To later let FatSecret nutrition enter CBoard's permanent food/diary snapshots, first confirm written permission for that storage and then update the UI and persistence strategy.

## Verification limits

No FatSecret credentials are configured in this workspace. Automated tests use mocked responses; they do not verify the Free Plan key's Basic endpoint access or live South Asian searches. The Free Plan data is US-only, so South Asian foods may be limited or absent.
