# CBoard recipes

**Card size** controls at the top of Recipes offer Small, Medium (default), and Large views. The selection applies to recipe library/management cards, alternative cards, and saved routine meal cards. Grid density, image sizes, padding and text adapt while keeping every recipe action available. Layouts remain responsive in both themes. The preference is stored in this browser under `cboard-recipe-card-size`, using the same local preference approach as the theme, and survives refresh. It does not alter your recipes or saved routine.

Recipes uses the existing React/JavaScript architecture, base-aware History API router, PageShell, AppNavigation, PrimaryButton, panel/pill/field-input classes, and Normal/Matrix theme rules. No new runtime dependency or theme is required.

## Add a recipe

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

Suggested ChatGPT prompt: “Create one CBoard recipe JSON object using schemaVersion 1 with title, mealType, ingredients and steps. Include alternatives as named groups referenced by ingredient.alternativeGroup. Use only known nutrition/quantities; omit unknown values. No Markdown fences, image URLs, or executable content.”

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
