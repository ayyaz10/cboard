"""Build the local USDA reference-food lookup from official public-domain releases.
Run with Python 3; downloads are cached outside the repository.
"""
import hashlib
import io
import json
import math
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SOURCES = [
    ('SR Legacy', '2018-04', 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip'),
    ('Foundation', '2026-04', 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip'),
]
# IDs, not nutrient names: units are validated before values are retained.
FIELDS = {
    'calories': ([1008, 2048, 2047], 'kcal'), 'protein': ([1003], 'g'),
    'carbs': ([1005], 'g'), 'fat': ([1004], 'g'), 'fiber': ([1079], 'g'),
    'sugars': ([2000, 1063], 'g'), 'saturatedFat': ([1258], 'g'),
    'sodium': ([1093], 'mg'), 'potassium': ([1092], 'mg'), 'calcium': ([1087], 'mg'),
    'iron': ([1089], 'mg'), 'magnesium': ([1090], 'mg'), 'zinc': ([1095], 'mg'),
    'vitaminA': ([1106], 'ug'), 'vitaminC': ([1162], 'mg'), 'vitaminD': ([1114], 'ug'),
    'vitaminE': ([1109], 'mg'), 'vitaminB12': ([1178], 'ug'), 'folate': ([1177], 'ug'),
}

def positive(value):
    return isinstance(value, (float, int)) and math.isfinite(value) and value > 0

def build():
    cache = Path(tempfile.gettempdir()) / 'cboard-usda-downloads'
    cache.mkdir(exist_ok=True)
    foods, sources = {}, []
    for kind, release, url in SOURCES:
        archive = cache / url.rsplit('/', 1)[1]
        if not archive.exists():
            with urllib.request.urlopen(url, timeout=60) as response:
                archive.write_bytes(response.read())
        raw = archive.read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
            dataset = json.loads(zipped.read(next(name for name in zipped.namelist() if name.endswith('.json'))))
        sources.append({'type': kind, 'release': release, 'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
        for food in next(iter(dataset.values())):
            if not isinstance(food, dict) or not food.get('fdcId') or not food.get('description'):
                continue
            nutrients = {n.get('nutrient', {}).get('id'): n for n in food.get('foodNutrients', [])}
            values = {}
            for key, (ids, expected_unit) in FIELDS.items():
                for nutrient_id in ids:
                    nutrient = nutrients.get(nutrient_id, {})
                    value = nutrient.get('amount')
                    unit = nutrient.get('nutrient', {}).get('unitName', '').lower().replace('\u00b5', 'u').replace('\u03bc', 'u')
                    if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 and unit == expected_unit:
                        values[key] = value
                        break
            if not any(key in values for key in ['calories', 'protein', 'carbs', 'fat']):
                continue
            portions = []
            for portion in food.get('foodPortions', []):
                weight, amount = portion.get('gramWeight'), portion.get('amount')
                if not positive(weight) or not positive(amount):
                    continue
                label = (portion.get('modifier') or portion.get('measureUnit', {}).get('name') or '').strip()
                if not label or label.lower() in ['undetermined', 'racc', 'nlea serving']:
                    continue
                portions.append({'label': label, 'grams': round(weight / amount, 6)})
            foods[food['fdcId']] = {'id': food['fdcId'], 'name': food['description'], 'type': kind, 'release': release, 'nutrition': values, 'portions': portions}
    output = Path(__file__).resolve().parents[1] / 'public' / 'nutrition'
    output.mkdir(exist_ok=True)
    payload = {'version': 1, 'source': 'USDA FoodData Central', 'license': 'CC0-1.0', 'sources': sources, 'foods': sorted(foods.values(), key=lambda f: f['id'])}
    (output / 'usda-foods.json').write_text(json.dumps(payload, ensure_ascii=True, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"Built {len(foods)} USDA foods; {(output / 'usda-foods.json').stat().st_size:,} bytes")

if __name__ == '__main__':
    build()
