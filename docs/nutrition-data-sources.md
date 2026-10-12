# Nutrition data sources

CBoard keeps nutrient amounts as the existing numeric fields on a food record. Missing amounts remain `null`; an explicit numeric `0` is retained. A sibling `nutrientSources` map stores source type, source record, confidence, estimate status, units, and derivation per nutrient. Diary entries copy both maps when logged, so later reference-data changes do not rewrite history.

## Canonical nutrient registry

`src/features/nutrition/nutrients.js` is the shared registry for field IDs, display names, canonical units, groups, aliases, and summary visibility. Food Diary totals, recipe calculations, meal-planner food records, grocery recipe totals, reports, and What-If calculations use the registry's keys. Adding a nutrient there extends those generic calculation paths.

Source adapters live in `src/features/nutrition/sourceAdapters.js`. Open Food Facts values are normalized from its per-100 g representation; CoFID and USDA reference records are normalized from their dataset mappings. Energy kJ and kcal are kept separately. A value derived from the other energy unit is marked derived. Salt and sodium are separate nutrients.

## Sources and refresh

- Open Food Facts is used for branded searches and exact barcode lookups through the authenticated `nutrition-search` Supabase Edge Function. Only the product query or barcode is sent; diary history is not sent. Search results are reviewable before saving.
- The checked-in CoFID index is generated from the GOV.UK 2021 workbook. Run `python scripts/build-cofid.py` to refresh it from the official download. The build preserves the workbook hash, food codes, name, unit basis, and nutrient values. Empty, trace, and `N` cells stay unknown. The public index uses the workbook's usual 100 g basis and a 100 ml basis for clearly identified alcoholic drinks.
- The USDA reference index is a downloaded FoodData Central release. `python scripts/build-natural-foods.py` imports the published releases listed in that script. It does not call the USDA API at runtime.

Reference lookup is user initiated. The reference enrichment action fills unknown nutrient fields only. Existing label, manual, or product values stay in place. Reference values are labelled as estimates in field provenance.

## Data portability

Food, recipe, grocery, and diary records are stored in the existing JSON preference/snapshot architecture. The new fields require no database schema migration and travel with existing backup/restore payloads. Local reference indexes are static public assets; saved food records work offline after they have been loaded.

Open Food Facts content is ODbL data. USDA FoodData Central is public domain (CC0). CoFID's public sector source is attributed under the Open Government Licence. Preserve those source links and licence metadata if exporting or republishing source-derived values.
