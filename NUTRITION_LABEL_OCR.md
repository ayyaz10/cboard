# Nutrition label scanning

One optional **Scan nutrition label** flow reads printed English nutrition labels and website screenshots locally, previews the selected nutrition column, and applies reviewed values to the current editor. Applying never saves a food, recipe, diary meal or calculation automatically. Manual entry remains available.

## Shared OCR and privacy

Finance and Nutrition use `src/services/ocr/imageOcr.js`, `imageProcessing.js`, `preprocess.worker.js` and `ocrLayout.js`. The Finance files retain compatibility exports and the receipt-specific parser, scoring and candidate policy. Nutrition uses separate `nutritionLabelParser.js` and `nutritionLabelOcr.js` under `src/features/nutrition/`.

The existing self-hosted Tesseract.js 7 English LSTM worker, WASM and language data are reused. The former Gemini label-photo UI now uses local OCR; it no longer invokes the nutrition-label cloud function or consumes AI quota. Photos and raw OCR structures exist only in scanner memory and are released on close/apply/unmount. No photo, full OCR text or word boxes are added to saved food records.

Files are JPEG/PNG/WEBP, at most 15 MB and 60 megapixels decoded. Images are oriented, resized to at most 2.5 megapixels, and candidates bounded to 4 megapixels/3,200 pixels. Conservative paper-panel detection can crop and rectify a plausible quadrilateral; borderless screenshots retain the original. Manual crop bounds and quarter-turn rotation are available. Local background normalization, grayscale, contrast, light sharpening, adaptive thresholding and global deskew run in a preprocessing worker. Nutrition preserves table geometry instead of using receipt-specific row stacking. The original candidate is always retained.

Nutrition compares at most three candidates (original/contrast PSM 6 and adaptive PSM 11), scoring recognizable fields, basis, uncertainty and OCR confidence. Two agreeing, confident passes can finish early. Candidate disagreements flag individual values. One Tesseract worker is reused for rescans in an open scanner, with cancellation, failure recovery and disposal. Form edits never rerun OCR. Language assets use the existing browser/PWA caching path. First use downloads the scanner; performance varies by phone.

## Parsing and review

The parser retains word coordinates, reconstructed rows, confidence, raw row/value text and column identity until review. Per-100g, per-100ml, serving/portion, item, pack, slice, scoop, container and pot headings are recognized. Serving weight/volume is kept when printed. Missing basis requires an explicit choice; no automatic per-100g assumption is made.

Multiple columns remain independently selectable. Coordinates assign partial rows to their printed column; text-only input with incomplete ambiguous columns is left blank. Repeated nutrition tables remain separate choices with a warning. Percent RI/DV numbers are excluded. Ingredients, allergy/storage text and unrelated text are filtered. Nutrient aliases cover UK/EU and common US wording. Limited OCR repairs apply to recognized nutrient names or numeric values and mark uncertain amounts.

Supported fields: kcal, kJ, protein, carbohydrate, fat, fibre, sugars, saturated fat, salt, sodium, potassium, calcium, iron, magnesium, zinc, vitamins A/C/D/E/B12 and folate. These are the existing nutrient fields plus an optional `energyKJ` extension. Grams/milligrams/micrograms are converted to each model field's canonical unit. Energy units stay distinct; missing kcal is not guessed from kJ. Salt and sodium remain separate. Percent-only nutrients remain unknown; missing units, upper-limit amounts and low-confidence values are flagged.

The review provides editable values, clearing, adding missing nutrients, column/basis selection, original-image preview and a temporary text view. Existing nutrition is compared on the selected basis when units are compatible. Checkboxes select replacements. Unchecked existing values are scaled only across compatible quantities; changing incompatible units or pack/item meanings requires explicit confirmation before clearing unchecked values. Nothing is silently adjusted to make totals match.

## Editor audit

| Area | Integration |
| --- | --- |
| Add food / shared custom-food library | `FoodItemEditor`; retains the entered name and saves normally. |
| Existing shared foods | Edit food action in both Food Library views opens the same editor and updates the same name-keyed record. |
| Food Diary: manual food, existing meal food, recipe-derived food | Scanner in `DiaryMealEditor`; keeps item identity/name and recipe linkage. Amount eaten stays separate; incompatible quantity units require re-entry. |
| Food Diary: Add food / replacement lookup | Existing photo choice in `NutritionLookup` uses the same scanner and review. |
| Add/Edit Recipe ingredients | Shared `RecipeFormEditor.ItemEditor`, including new and existing ingredients. |
| Sauces and alternative ingredients | The same `ItemEditor`, so scanning is available without separate implementations. |
| Ingredient nutrition pen | `IngredientNutritionRow`; retains a source nutrition label and saves via the normal recipe service. |
| Choose products & calculate nutrition | `RecipeProducts`; label basis and actual amount used remain distinct. |
| Intentional recipe-level nutrition | Explicit recipe-level scanner requires the labelled product amount in one recipe serving before applying. |
| Groceries: add/edit pantry or shopping items | Shared `NutritionFields` → `NutritionLookup` → scanner. Existing item name and stock quantity are retained. |
| Calorie portion calculator | Applies the label quantity and kcal; asks for the desired quantity in the label unit before Calculate. |
| Meal Planner / meal routine | Selects recipes and multipliers; no independent food/nutrient editor. Edit the linked recipe's ingredients to scan. |

The audit searched all JSX nutrient inputs and food/ingredient creation paths. Daily nutrition targets and the bodyweight-based protein calculator are goals/calculators, not product-label editors. Inventory-only future-item forms have no nutrition model. No existing food nutrition editor was left without the shared scan path.

## Storage and calculations

No SQL migration or new table is required. Existing JSON records gain optional `energyKJ` and allowlisted `source.labelBasis` metadata (basis/quantity/unit, serving quantity/unit/description). Existing cleaners preserve these fields in saved foods, diary foods, ingredient labels and product selections. Existing records without them remain valid.

Recipe label nutrition remains separate from recipe contribution: per-100g 200 kcal/20g protein applied to 150g produces 300 kcal/30g protein while the source label remains per 100g. Unknown weight/volume conversions require user input. Existing saved-food update and recipe propagation flows remain in use.

## Verification and limitations

All **286 source tests pass**, including **27 new nutrition OCR tests**. `nutritionLabelParser.test.js` covers UK/US labels, simple lists, screenshots, serving sizes, multiple columns/tables, coordinates, kcal+kJ, aliases, salt/sodium, mass units, percentages, missing/negative/uncertain values, OCR typos, replacement rules, persistence, recipe scaling and preprocessing fallback/geometry.

`scripts/check-nutrition-labels.cjs` uses real browser OCR of a generated two-column label through the actual food, existing-food, recipe, pen, diary, recipe-product, lookup and calorie-calculator editors. It exercises corrections/checkboxes, mobile-width review, worker reuse, cancellation/retry, corrupt images and same-origin OCR requests. Auth/persistence are isolated test doubles; no real account is written. Start Vite on port 5177, set `PLAYWRIGHT_PATH` to an installed Playwright package, then run the script. The generated harness is removed on exit; screenshots stay in the OS temporary directory.

The exact original Aldi photo is also rerun with the existing Finance browser regression to protect receipt behavior after sharing the infrastructure. Run all source tests with `node --test` over `src/**/*.test.js`; production packaging uses `npm run deploy` and `npm run verify:pwa`.

`scripts/check-nutrition-site.cjs` verifies the actual production bundle and OCR worker/model URLs at mobile width. It reads a generated label as 200 kcal, 20g protein and 840kJ and applies it to the calorie calculator. The site code and OCR assets are real; authentication/database responses are test doubles so no real account is modified. Set `NUTRITION_SITE_URL` for a local production preview, or leave it unset for the published CBoard website.

Limitations: English printed text, supported raster formats, heuristic region/column detection, no handwriting/PDF/HEIC, no reliable recovery of glare or missing text. Curved/glossy packaging and unusual multirow headers can need crop/rotation/manual correction. Upper-limit values are review estimates, not exact label quantities. Unknown nutrients stay unknown. Validation uses generated nutrition imagery and the supplied real receipt, not a broad real-package corpus or physical phone camera testing. Review is required before applying.
