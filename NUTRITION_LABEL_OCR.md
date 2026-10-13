# Nutrition label scanning

One optional **Scan nutrition label** flow uses a dedicated PaddleOCR-VL 1.6 service for advanced photographed-label/document parsing when `VITE_NUTRITION_OCR_URL` is configured. It previews the selected nutrition column and applies reviewed values to the current editor. Applying never saves a food, recipe, diary meal or calculation automatically. Manual entry remains available.

## Shared OCR and privacy

Finance and the explicit basic Nutrition fallback use `src/services/ocr/imageOcr.js`, `imageProcessing.js`, `preprocess.worker.js` and `ocrLayout.js`. Nutrition's advanced provider boundary lives in `nutritionLabelOcr.js`: Paddle's structured document output is converted by `nutritionOcrDocument.js` to input for the existing `nutritionLabelParser.js`; Tesseract remains selectable as a basic local fallback. The Finance files retain compatibility exports and the receipt-specific parser, scoring and candidate policy.

PaddleOCR-VL images are sent only to the configured CBoard OCR service; inference is local to that service and uploaded files are deleted after processing. The service contains no third-party OCR API call. The basic Tesseract.js 7 English/Spanish/Portuguese workers remain in the browser as an explicit fallback. The former Gemini label-photo UI no longer invokes the nutrition-label cloud function or consumes AI quota. Photos and raw OCR structures exist only in scanner memory and are released on close/apply/unmount. No photo, full OCR text or word boxes are added to saved food records.

Files are JPEG/PNG/WEBP, at most 15 MB and 60 megapixels decoded. Images are oriented, resized to at most 2.5 megapixels, and candidates bounded to 4 megapixels/3,200 pixels. Conservative paper-panel detection can crop and rectify a plausible quadrilateral; borderless screenshots retain the original. Manual crop bounds and quarter-turn rotation are available. Local background normalization, grayscale, contrast, light sharpening, adaptive thresholding and global deskew run in a preprocessing worker. Nutrition preserves table geometry instead of using receipt-specific row stacking. The original candidate is always retained.

PaddleOCR-VL 1.6 runs with document orientation correction, unwarping and layout/table detection; the model is loaded once by the service. Browser rotation/crop controls are preserved and passed as a colour image. Paddle returns structured table blocks and layout evidence; the region score is kept separate from numeric-cell confidence, which is conservatively flagged for review when the model does not supply it. If the service is unavailable, the scanner offers an explicit local Tesseract scan or closes for manual entry. One Tesseract worker is reused for basic rescans, with cancellation, failure recovery and disposal. Form edits never rerun OCR.

## Parsing and review

The parser retains table rows, bounding region, region confidence, raw row/cell text, normalized values and column identity until review. Per-100g, per-100ml, serving/portion, item, pack, slice, scoop, container and pot headings are recognized. Serving weight/volume is kept when printed. Missing basis requires an explicit choice; no automatic per-100g assumption is made. When printed per-100g and serving values differ beyond their display-rounding tolerance, the candidate is highlighted and a comparison warning is shown.

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

`nutrition-ocr-service/README.md` documents the standalone service, local run steps and deployment contract. `scripts/check-milka-paddle-ocr.mjs` sends the real Milka photo through the service and prints expected versus actual values. `nutritionOcrDocument.test.js` covers the sanitized result from the actual Paddle run; no heavy OCR model runs in the regular JavaScript test suite. The basic parser, replacement, persistence and browser editor checks remain separate from the Paddle regression.

Run source tests with `node --test` over `src/**/*.test.js`; production packaging uses `npm run deploy` and `npm run verify:pwa`.

`scripts/check-nutrition-site.cjs` verifies the actual production bundle and OCR worker/model URLs at mobile width. It reads a generated label as 200 kcal, 20g protein and 840kJ and applies it to the calorie calculator. The site code and OCR assets are real; authentication/database responses are test doubles so no real account is modified. Set `NUTRITION_SITE_URL` for a local production preview, or leave it unset for the published CBoard website.

Limitations: the live Milka proof used PaddleOCR-VL 1.6 on CPU. It detected the table and read every expected per-100g nutrient, but the table HTML shifted the energy/fat/saturates labels by one row and the model read serving fat as 9.2 g instead of the printed 9.3 g. The table adapter corrects the demonstrable row shift from the energy units; all candidates remain reviewable and conservative confidence is retained. CPU scans took several minutes, so an interactive production deployment needs a separate adequately sized GPU service. A production OCR service URL has not been deployed/configured in this repository. Curved/glossy packaging, glare, unusual multirow headers or missing text may still need crop/rotation/manual correction. Percentages remain excluded; unknown nutrients stay unknown. Review is required before applying.
