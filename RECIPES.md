# CBoard recipes

The compact **View** dropdown beside the recipe count offers Tiles, Cards (default), Gallery and Details. Details displays full-width rows with smaller thumbnails; the other modes adjust card density. Previous Small/Medium/Large preferences map to Tiles/Cards/Gallery and remain stored under `cboard-recipe-card-size`. The dropdown appears in the library and management view, not above an opened recipe. Clicking a card image, title or background opens the recipe; favourite and source controls retain their own actions. **Edit Recipe** is at the top of an opened recipe, before the daily targets.

Recipes uses the existing React/JavaScript architecture, base-aware History API router, PageShell, AppNavigation, PrimaryButton, panel/pill/field-input classes, and Normal/Matrix theme rules. No new runtime dependency or theme is required.

## Add a recipe

Tap the **heart** on a saved recipe card or recipe page to add/remove it from your favourites. Choose **Favourites** in the library or management view to filter the list; search and meal-type filters still apply. Hearts have keyboard support and phone-sized touch targets in both themes. Favourites sync to the signed-in account using separate `recipe-favourite:v1:<slug>` rows in the existing RLS-protected `user_tool_preferences` table, so recipe edits do not reset them and no migration is needed. Deleting a recipe removes its favourite marker in the same database operation. Failed saves revert the heart and show an error. Favourite markers are personal preferences and are not part of imported recipe JSON.

1. Open **Recipes → Add Recipe**.
2. Paste one JSON object or an array of recipe objects from ChatGPT, or upload a `.json` file (up to 2 MB total and 256 KB per recipe).
3. Optionally upload/drop a JPG, PNG or WebP photo (up to 5 MB).
4. Select **Preview Recipe**. Review ingredients, instructions, macros and all alternative groups.
5. Choose **Save Recipe**. The detail page opens only after Supabase confirms the write.

Use **Edit Data** to return to the form, or **Cancel** to discard the draft. Unsaved drafts are not persisted. Manage Recipes supports edit, duplicate (preview before save), and confirmed delete. Editing retains the slug to preserve links. Imports and duplicates get a unique suffix when necessary; a database constraint also prevents simultaneous imports overwriting each other. Saves from two editors of the same recipe use last-write-wins, consistent with other CBoard tools.

## Form editing

**Edit Recipe** now opens a form by default. Edit the title, meal category, description, times, servings, tags, recipe macros, ingredient names/amounts/units/notes, optional item macros, instructions, sauces, existing alternative groups/options, and source URL/label/type/card visibility. Ingredients, instructions, sauces, and existing alternative options can be added or removed. Keep at least one ingredient, instruction, and option in each alternative group. New alternative groups can be defined through the JSON editor. Image upload/removal remains available below the form.

Choose **Preview Recipe → Save Recipe** to persist changes. Macros do not recalculate automatically; blank numeric fields remain unknown. **JSON editor** and **Form editor** switches transfer the current draft without saving it. JSON must be valid before switching into the form. New single recipes can also be entered using Form editor from Add Recipe; batch editing remains in JSON until import, after which each saved recipe has its own form. Existing recipe slugs stay fixed to preserve links. Cancel discards unsaved edits.

## Batch import workflow

Use the same **Add Recipe** button and paste/upload a JSON array: `[ { recipe one }, { recipe two } ]`. Each element uses the existing recipe schema. Import 1–20 recipes per batch. Download [a complete batch example](public/recipes/batch-example.json) or [the batch schema](public/recipes/batch.schema.json).

Preview validates every recipe before allowing a save; errors identify the recipe number and invalid field. Select each recipe's title in the preview to review its ingredients/alternatives and upload its own image. The image input before preview applies only to single-recipe imports. Uploaded batch images stay attached to their recipe while switching previews or returning to unchanged data. Changing/reordering a recipe in Edit Data requires reattaching its image to avoid assigning a photo to the wrong meal.

**Save All N Recipes** inserts the entire batch in one Supabase operation and returns to the library. Existing slugs and repeats within the batch receive unique suffixes, shown before saving. Database errors leave the preview and images available for retry. A slug conflict rejects the whole insert; return to Edit Data and preview again to refresh the unique slugs. The batch is atomic, with no partial imports. Keep the combined recipe/image payload under 12 MB; use smaller images or smaller batches if needed. Editing an existing recipe remains a single-recipe operation.

## Persistence

### Current meal routine

**Quick routines** stores up to 30 reusable combinations in the existing Supabase preference `recipes:routine-presets:v1`. Choose/name a combination in the editor, then **Save current combination as preset**. Presets contain recipe references and portions, not copies of recipe images or macros. **Use routine** saves the selected preset as the current plan in one click; unsaved editor changes require confirmation before replacement. **Edit preset** loads a combination into the editor, where **Update selected preset** updates that preset without changing other presets or the saved current routine. You can also save the edited combination as a new preset. **Delete preset** requires confirmation and never removes the active plan or recipes. Preset saves, current-plan activation, and deletion show failures without claiming success. Library updates follow the existing preferences last-write-wins behavior across simultaneous tabs/devices.

The planner now opens your saved routine as a read-only overview grouped into Breakfast, Lunch, Dinner and Snack. Each selected meal shows its recipe image, portion multiplier, macros and recipe link, with combined daily totals above. Add a routine name and optional notes when choosing meals, then click **Use this meal routine**. It becomes your current everyday plan until changed. **Edit routine** opens the selectors again; **Cancel changes** restores the saved selections and notes. Only one current routine is stored, not a history of dated plans.

The existing `recipes:daily-plan:v1` preference now stores `{ version: 1, name, notes, entries }` atomically. Older saved arrays of meal selections load automatically with the default name “My current meal routine”; the next save upgrades the stored shape without losing selections.

The **Daily Meal Planner** link on Recipes opens `/recipes/planner/day`. Choose breakfast, lunch, dinner and snacks, or add extra meal slots (up to 24). Each selection has a portion multiplier: 1× uses the recipe's listed macros as entered, 0.5× halves them, and 2× doubles them. The planner does not divide by the recipe's `servings` field because older imports do not establish whether their macros describe one serving or the entire recipe. Ensure the stored macros represent your intended 1× portion. Missing values remain unknown, and affected totals are labeled as known subtotals. Deleted recipes are flagged for replacement.

Click **Use this meal routine** to persist selections and multipliers in the existing Supabase preferences table under `recipes:daily-plan:v1`. This is one reusable daily plan, not a dated food log. It remains available after reloading/signing back in. Totals use the current recipe data, so editing recipe macros updates the next planner view. Saving does not change recipe contents. Unsaved changes are labeled; load/save failures are shown with retry available. Additional tests: `node --test src/features/recipes/mealPlanData.test.js`.

Planner verification: build and all 21 unit tests pass. Chrome checks covered selection, portion multipliers, missing macro subtotals, extra meals, failed-save retry, repeated save/reload, deleted recipe handling, and mobile Matrix layout. Browser backend responses were simulated; no live account writes were tested.

The existing Supabase `public.user_tool_preferences` table supports arbitrary JSONB values and already has per-user row-level security and a unique `(user_id, key)` constraint. Each recipe occupies a separate row with key `recipe:v1:<slug>` and value `{ "recipe": { ... }, "image": "data:image/webp;base64,..." }`. Recipe operations explicitly scope queries to the authenticated user as well as relying on the existing RLS. No schema migration, storage bucket, or additional backend is needed. Recipes are isolated from preferences used by other tools and survive refresh, sign-out/sign-in, and browser restarts. They are available on another device signed into the same account. Network errors are shown; failed saves retain the preview for retry.

Images follow Notes' existing embedded-data approach. The uploader checks extension, MIME type, signature, and browser decoding, resizes to at most 1400 pixels on the longest side, and encodes WebP at quality 0.82 (PNG fallback when necessary). The stored image is limited to approximately 1 MB of binary data. Recipe and image are saved atomically in the same database row; replacing/deleting a recipe therefore cannot leave orphaned image files. This is suitable for a personal meal library. Very large libraries would benefit from moving image bytes into Supabase Storage in a future migration. No browser-local fallback pretends that a failed cloud save succeeded.

## Stable JSON format

Optional `source` adds a **Recipe source** section to the detail page and import preview. Set `showOnRecipeCard: true` to also show the link on the library card. Links open in a new tab, support both themes, and persist with the recipe through imports, edits and duplication. Older recipes without a source show no extra section. To add a source to a saved recipe, use Edit Recipe, add this object to its JSON, preview and save:

```json
"source": {
  "type": "youtube",
  "label": "Original Recipe Video",
  "url": "https://youtu.be/PXub4lr-9J8?si=BezeVek1HJWp7EUR",
  "showOnRecipeCard": true
}
```

Only absolute HTTP(S) links without embedded credentials are accepted. Markdown-wrapped links such as `[video](https://example.com)` are normalized on import. Omit `source` or set it to null to remove the link. Type defaults to `website`, label to `Original recipe`, and card visibility to false. Sources are external links, not embedded videos.

The complete machine-readable schema is [public/recipes/recipe.schema.json](public/recipes/recipe.schema.json). A complete import example is [public/recipes/greek-yogurt-oats.json](public/recipes/greek-yogurt-oats.json); dinner is [public/recipes/egg-fried-rice.json](public/recipes/egg-fried-rice.json). These files are also downloadable in the app.

| Field | Format |
| --- | --- |
| `schemaVersion` | Optional; currently `1` |
| `title`, `mealType` | Required nonblank strings; custom meal types supported |
| `slug` | Optional lowercase letters/numbers separated by hyphens; generated from title if omitted; `manage` and `import` reserved |
| `description` | Optional plain text |
| `nutrition` | Optional object with `calories`, `protein`, `carbs`, `fat`; non-negative numbers or null. Calories in kcal, other macros in grams; values displayed exactly as supplied |
| `prepTime`, `cookTime` | Optional strings or null, e.g. `"5 min"` |
| `servings` | Optional positive number or null |
| `ingredients` | Required nonempty array of ingredient objects |
| `steps` | Required nonempty array of nonblank strings |
| `sauces` | Optional array of strings or ingredient objects; hidden when empty |
| `alternatives` | Optional object keyed by route-safe group IDs; each contains a nonblank `title` and nonempty `options` array |
| `tags` | Optional array of nonblank strings |

Ingredient/option objects contain required `name`, optional `amount` (non-negative number, text such as `"142 g / 5 oz"`, or null), `unit`, `note`, and `nutrition`. Ingredients may include `alternativeGroup` matching a key in `alternatives`. Unknown quantities are omitted/null, never guessed. Alternative option nutrition is displayed independently; selecting/viewing alternatives does not recalculate the recipe's macros. Only ingredients link to alternatives, not sauce entries or nested alternative options.

Imported HTML is displayed as plain text through React. Unknown fields are discarded, including imported image URLs, event handlers and account IDs. Upload photos separately. The schema describes the supported document; runtime validation additionally checks whitespace-only values and alternative references. Arrays are limited to 100 entries, general text to 4000 characters, titles/names to 200, and categories/tags/slugs to 100. Error messages identify the relevant field.

Use the app's **Copy ChatGPT prompt** or [the complete conversion prompt](./src/features/recipes/recipe-conversion-prompt.txt). It requests a five-key `nutrition` object for every ingredient, scaled to its listed whole-recipe quantity, and separately labeled recipe-level totals. Supplied labels take priority; generic estimates must be identified in ingredient notes with their assumptions. Material ambiguities require clarification, and incomplete nutrient sums must not be presented as complete totals. The prompt uses only fields accepted by the existing importer.

## Starter content

The oats and dinner files use supplied quantities, with missing nutrition left blank. Dinner's preparation method is explicitly marked as suggested. Starters are reviewed and saved through the same importer as future recipes, not automatically reinserted after deletion. Chicken Burrito and Banana Peanut Butter Smoothie were not seeded because the repository contains no recipe data for them and the request does not establish complete quantities/instructions. They can be imported once that information is available.

## Verification

Run `npm run build` and `node --test src/features/recipes/recipeData.test.js src/features/calculators/positionSize/positionSizeMath.test.js`. There is no configured lint script. Recipe pages reuse the existing theme rules including Matrix backgrounds, borders, inputs, buttons and typography. Browser test results and limitations are reported with the implementation handoff.

Verified: production build and all 16 unit tests pass. Chrome checks passed paste/file import, image upload, preview, failed-save retry, save/reload/fresh browser context, alternatives/deep-link reload, edit, duplicate, search/filter, keyboard cancellation, delete/reload, desktop Normal and mobile Matrix rendering, and absence of mobile horizontal overflow or browser exceptions. Batch checks also passed indexed validation errors, per-recipe image isolation, image preservation through Edit Data, failed-batch retry, array insert and reload. Browser tests intercepted Supabase responses; live account writes were not exercised. Vite reports a bundle-size warning.

## File inventory

Created:
- `src/features/recipes/Recipes.jsx`: routes, library, search, filters and management.
- `src/features/recipes/RecipeComponents.jsx`: shared cards, detail view, ingredients, nutrition, steps, alternatives, images and links.
- `src/features/recipes/RecipeImporter.jsx`: JSON upload/paste, preview and save workflow.
- `src/features/recipes/RecipeImageUploader.jsx`: image chooser, drop target and preview.
- `src/features/recipes/recipeData.js`: parsing, validation, normalization and slug helpers.
- `src/features/recipes/recipeImage.js`: image validation and resizing.
- `src/features/recipes/recipeData.test.js`: validation and data-safety tests.
- `src/services/recipeService.js`: user-scoped Supabase persistence.
- `public/recipes/recipe.schema.json`: stable import schema.
- `public/recipes/greek-yogurt-oats.json`: complete example import.
- `public/recipes/egg-fried-rice.json`: dinner starter import.
- `public/recipes/batch-example.json`: complete two-recipe import example.
- `public/recipes/batch.schema.json`: schema for arrays of recipes.
- `RECIPES.md`: instructions, persistence details, schema guide and inventory.

Modified:
- `src/app/App.jsx`: authenticated recipes routing.
- `src/components/layout/AppNavigation.jsx`: Recipes navigation item.
- `src/components/pages/AppBoard.jsx`: Recipes workspace card.
- `src/components/ui/PrimaryButton.jsx`: forwards event handlers and disabled/accessibility props.

## Product-based recipe nutrition

Every saved recipe has a “Choose products & calculate nutrition” panel, including older recipes. Search Open Food Facts by product/brand, scan or enter a barcode, review a label photo, or enter label values manually. Confirm the full-recipe amount and servings. Grams and millilitres are never interchanged automatically; cups and unspecified quantities need confirmation. Piece-based label values are supported when the label explicitly gives that basis.

Product choices and label snapshots are saved inside the existing user-scoped recipe JSON as `productNutrition`; no migration or new API key is needed. Saving replaces the recipe header/card/planner macros with per-serving calculations, and writes full-quantity values to ingredients and sauces. Unknown nutrients remain null until every ingredient has a value; zero is retained. Alternatives are not counted. Product choices persist per recipe, not as global ingredient defaults, and refresh only when a product is selected again. Imported nutrition is retained until the user saves product calculations.

Changing servings recalculates saved product nutrition. Editing ingredient names, amounts, units, notes or sauces invalidates the saved product bindings and clears their derived nutrition to prevent stale totals. Saves check the recipe revision to avoid overwriting concurrent edits. The older fibre-only tool is hidden after product nutrition is saved because fibre now derives from the selected labels.

Validation: `node --test` and `npm run build`. Browser checks cover mocked lookup selection, manual labels, totals, saving/reloading and 320/390/1440-pixel layouts in both themes. Live provider accuracy and camera/photo recognition depend on the existing nutrition services.

## Food diary and meal history

Open **Recipes ? Food diary** (`/recipes/diary/day`), also linked from the Daily Meal Planner. Choose today or any past date, then log breakfast, lunch, dinner and optional snacks. Entries can include saved recipes, selected meals from the saved planner routine, Open Food Facts results, barcode/label-photo results, or manual food values. Recipe ingredients with saved product labels import as editable per-serving food snapshots. Older recipes can use their listed nutrition as one portion or explicitly import ingredient quantities divided by the recipe serving count. Diary edits never change the recipe library or previous days.

Amounts can use the label's grams, millilitres, pieces or servings. For a per-100-g food such as boiled eggs, logging two pieces requires an explicit edible weight per piece. No weight is guessed and grams are never silently converted into millilitres. Label corrections and missing nutrients can be edited. Daily totals show calories, protein, carbs, fat, fibre, sugar, saturated fat, salt, sodium, potassium, calcium, iron, magnesium, zinc, vitamins A/C/D/E/B12 and folate. OFF standardized gram values are converted to the displayed mg/µg units ([API nutrition schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition/)). Unknown values remain unknown, and incomplete totals are labelled as known subtotals. Generic foods and micronutrient coverage depend on provider records; manual entry is available.

Each date is one `user_tool_preferences` row keyed `food-diary:v1:YYYY-MM-DD`. The existing user-scoped RLS and unique constraint apply; no database migration or new API key is required. Each meal stores its own food quantities, nutrient values and source snapshot. Read pagination includes all history; inserts and revision-checked updates protect against concurrent overwrites. Failed saves keep the editor draft, and conflict recovery reloads saved entries while preserving that draft. These controls are client validation plus existing preference-row ownership enforcement, not database nutrient constraints.

To count a day towards the streak, log at least one meal, account for breakfast/lunch/dinner by logging or marking skipped, and choose **Finish day & update streak**. Snacks are optional. The current streak includes yesterday while today is unfinished, breaks after a missed calendar day, and can include backfilled days. Longest streak and completed-day count are shown. Editing, deleting or changing a meal status reopens the day until reviewed again. Dates follow the device's local calendar; date arithmetic uses calendar days across daylight-saving changes. History can be filtered by month and opened for review or correction.

Validation includes `node --test`, production build, and browser checks with mocked Supabase/food responses for recipe-plus-eggs entries, micronutrient conversion, planner copies, editing/deletion, reload persistence, history/streaks, failed saves and revision conflicts, and 320/390/1440-pixel layouts in Original and Matrix themes. Camera and external food-provider data are existing integrations rather than guarantees of complete nutrition records.

Recipe product nutrition previews update the recipe header immediately when label values, amounts or servings change. Saving persists the per-serving macros to the recipe and its cards. Ingredient amounts recognize explicit mass/volume unit names, numeric strings and simple fractions; unsupported piece-to-weight or cup conversions still need the edible amount entered manually. Each ingredient shows the amount-to-label calculation.

The recipe form now includes **Find nutrition from food API** directly inside every ingredient, sauce and alternative editor. Selecting a product fills Item nutrition for the amount above. Matching weights/volumes convert immediately; count-based amounts (for example half a banana) need a confirmed edible weight per recipe unit. `nutritionLabel` preserves the reference values and conversion so future amount edits recalculate after reopening. `nutritionFromIngredients` computes the recipe macros per serving from ingredient and sauce values; alternatives are excluded and unknown values remain blank. Changing the food name clears the old label; editing an item macro switches that ingredient to manual values.

## Natural foods and estimated portions

The shared nutrition lookup offers **Natural foods** alongside **Branded products** in recipe ingredients, recipe product calculations, groceries and the food diary. Natural foods searches a downloaded USDA FoodData Central catalog with over 8,000 foods, including raw cashews, apples, bananas and cooked eggs. It uses SR Legacy April 2018 and Foundation April 2026 data; this is not a live USDA API request. No additional key or migration is required. Provenance and rebuild instructions are in `public/nutrition/README.md`.

Select a matching food and either enter its edible weight or choose a USDA portion such as medium banana. Portion weights are explicitly estimates: a medium banana is 118 g, so half uses 59 g and 52.51 kcal from the 89 kcal/100 g reference. Recipe ingredients retain the per-100-g reference and selected weight so amount changes recalculate. Diary and grocery selections retain per-portion values for quantity changes. Missing nutrient values remain unknown. Existing recipes can use this lookup when edited; saved data is never silently replaced.
