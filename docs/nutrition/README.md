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
