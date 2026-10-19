# Nutrition label scanning

One shared **Scan nutrition label** flow uses OCR.Space through the authenticated Supabase `nutrition-ocr` Edge Function when configured. It automatically falls back to the local Tesseract scanner on cloud errors, missing configuration, rate limits, or offline use. It previews the selected nutrition column and applies reviewed values to the current editor. Applying never saves a food, recipe, diary meal or calculation automatically. Manual entry remains available.

## Shared OCR and privacy

Finance and Nutrition's local fallback use `src/services/ocr/imageOcr.js`, `imageProcessing.js`, `preprocess.worker.js` and `ocrLayout.js`. The common provider contract is in `src/services/ocr/ocrProvider.js`. Nutrition's provider boundary lives in `nutritionLabelOcr.js`: OCR.Space output is normalized by `nutritionOcrDocument.js` to input for the existing `nutritionLabelParser.js`; Tesseract remains the local fallback. The Finance files retain compatibility exports and the receipt-specific parser, scoring and candidate policy.

Cloud scans send a prepared JPEG over HTTPS to the authenticated CBoard Edge Function, which forwards it as multipart data to OCR.Space's POST endpoint. Images are not uploaded to a public URL or Supabase Storage and are not logged. `OCR_SPACE_API_KEY` is server-side only. OCR.Space's FAQ says uploaded documents are deleted after processing; CBoard also discards its temporary copy on close/apply/unmount. The basic Tesseract.js 7 English/Spanish/Portuguese workers remain in the browser and work offline. No photo, full OCR text or word boxes are added to saved food records.

Files are JPEG/PNG/WEBP, at most 15 MB and 60 megapixels decoded. Images are oriented, resized to at most 2.5 megapixels, and candidates bounded to 4 megapixels/3,200 pixels. Conservative paper-panel detection can crop and rectify a plausible quadrilateral; borderless screenshots retain the original. Manual crop bounds and quarter-turn rotation are available. Local background normalization, grayscale, contrast, light sharpening, adaptive thresholding and global deskew run in a preprocessing worker. Nutrition preserves table geometry instead of using receipt-specific row stacking. The original candidate is always retained.

Engine, scaling and response options are centralized in the Edge Function configuration. Engine 3 is the default based on the regression comparison below; Engine 2 remains selectable through `OCR_SPACE_ENGINE`. Both use automatic language detection, table mode, orientation detection and word overlays; scaling is off. JPEG quality/size are adjusted to stay below the current free endpoint's 1 MB upload limit. OCR.Space can split a visual row into separate column overlays, so CBoard rejoins words on a shared baseline and retains their x coordinates for the existing parser. OCR.Space does not provide confidence values in the overlay, so confidence remains unknown/conservative; OCR validation and review still apply. Cloud failure automatically starts local Tesseract with the same selected image/crop. One Tesseract worker is reused for rescans, with cancellation, failure recovery and disposal. Form edits never rerun OCR.

## Supabase setup

Set the key and optional engine settings as Edge Function secrets, then deploy:

```sh
supabase secrets set OCR_SPACE_API_KEY=your_ocr_space_api_key OCR_SPACE_ENGINE=3 OCR_SPACE_SCALE=false
supabase functions deploy nutrition-ocr --project-ref YOUR_PROJECT_REF
```

Never add the key to `.env`, `VITE_*`, the client bundle, or Git. OCR.Space's current free documentation lists a 1 MB file limit; CBoard compresses cloud images below that size. The function authenticates the CBoard user, validates the image, applies per-user in-memory throttling, and accepts only the image upload (no arbitrary URL fetching). OCR.Space documents POST header authentication as `apikey`, with file and engine options in multipart form data.

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

The legacy `nutrition-ocr-service/` and `scripts/check-milka-paddle-ocr.mjs` remain available for the prior PaddleOCR-VL benchmark only; the Nutrition UI no longer calls them. OCR.Space provider normalization and Edge Function tests use the documented response shape and do not consume cloud quota. A live comparison used OCR.Space's published demo key on a generated clean two-column table and the checked-in Milka photo, resized to JPEG under 1 MB. On the clean table, Engine 3 returned the complete table including both bases; Engine 2 missed the saturated-fat value and misread sugars. On Milka, Engine 2 was mostly garbled and could not produce a CBoard column. Engine 3 recognized substantially more labels and values but some decimals/labels remained ambiguous and CBoard correctly rejected the result. Engine 2 took about 0.6 seconds; Engine 3 took about 4.3 seconds on the clean table and 7.0–7.6 seconds on Milka. A direct local Tesseract.js `eng+spa+por` baseline on Milka took about 5.9 seconds and was also too garbled to parse. These are individual samples, not a broad accuracy claim; the scanner uses its existing local multi-variant preprocessing on fallback.

Run source tests with `node --test` over `src/**/*.test.js`; production packaging uses `npm run deploy` and `npm run verify:pwa`.

`scripts/check-nutrition-site.cjs` verifies the actual production bundle and OCR worker/model URLs at mobile width. It reads a generated label as 200 kcal, 20g protein and 840kJ and applies it to the calorie calculator. The site code and OCR assets are real; authentication/database responses are test doubles so no real account is modified. Set `NUTRITION_SITE_URL` for a local production preview, or leave it unset for the published CBoard website.

Limitations: OCR.Space's published demo key has a low Engine 3 request allowance; use your own key for further tuning. The Milka photo remains difficult for both cloud engines and the direct local baseline, so the measured Engine 3 advantage is better text recovery rather than a guaranteed accepted nutrition result. Supabase deployment and `OCR_SPACE_API_KEY` setup are required for cloud scans. The free OCR.Space service has no uptime guarantee. Curved/glossy packaging, glare, unusual multirow headers or missing text may still need crop/rotation/manual correction. Percentages remain excluded; unknown nutrients stay unknown. Review is required before applying.
