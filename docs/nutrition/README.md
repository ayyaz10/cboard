# USDA reference foods

`usda-foods.json` is a compact, downloadable reference catalog derived from
[USDA FoodData Central](https://fdc.nal.usda.gov/download-datasets/): SR Legacy
(April 2018) and Foundation (April 2026). USDA data is public domain (CC0).
The catalog records release URLs and source archive SHA-256 hashes.

Rebuild from the repository root with `python scripts/build-natural-foods.py`.
Archives are cached in the operating system's temporary directory. Update the
script's release URLs when deliberately refreshing the catalog, then run tests.

The app loads this file only when Natural foods is searched. No USDA API key,
live USDA request, or database migration is needed. Branded products continue
to use the existing Open Food Facts integration.

Nutrients are per 100 g of edible food. Household portion weights are normalized
to one unit and explicitly presented as estimates. Missing nutrients remain
unknown; salt is not inferred from sodium. Vitamin A uses RAE. Foundation and
SR Legacy can have different values; users choose the matching preparation and
source. Saved recipes and diary entries retain their chosen nutrient snapshot.

## Nutrition label OCR

Nutrition labels have a punctuation-preserving OCR path with original, grayscale,
and lightly sharpened passes. It leaves out the receipt scanner's thermal
thresholding. Reconstructed punctuation stays with nearby digits in the same
row. When Tesseract omits a printed decimal, a small pixel check can restore it
only when a separate dot sits between the scanned digits. The same check can
recover a trailing `g` that was read as `9`. OCR text, word boxes, confidence,
and pixel evidence remain visible in the development diagnostics.

Candidate ranking flags wide energy and macro contradictions but never edits a
number based on a formula. The source image stays temporary. A basis remains
unknown when no heading is visible; matching full-image passes can supply a
heading that was outside a crop, and the review asks the user to confirm an
unreadable basis.

Run `node --test src/features/nutrition/nutritionLabelParser.test.js
src/features/nutrition/nutritionDecimals.test.js` for parser checks. With the
dev server running on port 5177, `node scripts/check-nutrition-image.cjs` scans a
synthetic Aldi-style screenshot using the real local Tesseract worker. Set
`NUTRITION_TEST_IMAGE` to check a specific local JPEG, PNG, or WEBP file.
