"""Index the official GOV.UK CoFID 2021 workbook as a compact local food catalog.

Uses Python's standard library only. Empty cells and CoFID trace / not-detected
markers remain unknown; only numeric zeroes become explicit zero values.
"""
import hashlib
import io
import json
import re
import tempfile
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

URL = 'https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx'
VERSION = 'CoFID 2021'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}
ALIASES = {
    'protein': ('protein', 1), 'fat': ('fat', 1), 'carbohydrate': ('carbs', 1), 'total sugars': ('sugars', 1),
    'energy (kcal) (kcal)': ('calories', 1), 'energy (kj) (kj)': ('energyKJ', 1),
    'non-starch polysaccharide': ('fiber', 1), 'dietary fibre': ('fiber', 1), 'energy (kcal)': ('calories', 1),
    'energy (kj)': ('energyKJ', 1), 'saturated fatty acids': ('saturatedFat', 1), 'total saturated fatty acids': ('saturatedFat', 1),
    'monounsaturated fatty acids': ('monounsaturatedFat', 1), 'total monounsaturated fatty acids': ('monounsaturatedFat', 1),
    'polyunsaturated fatty acids': ('polyunsaturatedFat', 1), 'total polyunsaturated fatty acids': ('polyunsaturatedFat', 1),
    'sodium': ('sodium', 1), 'potassium': ('potassium', 1), 'calcium': ('calcium', 1), 'magnesium': ('magnesium', 1),
    'phosphorus': ('phosphorus', 1), 'iron': ('iron', 1), 'copper': ('copper', 1), 'zinc': ('zinc', 1), 'manganese': ('manganese', 1),
    'selenium': ('selenium', 1), 'iodine': ('iodine', 1), 'retinol equivalent': ('vitaminA', 1), 'total retinol equivalent': ('vitaminA', 1), 'total vitamin d': ('vitaminD', 1),
    'total vitamin e': ('vitaminE', 1), 'phylloquinone': ('vitaminK', 1), 'thiamin': ('vitaminB1', 1), 'riboflavin': ('vitaminB2', 1),
    'niacin': ('vitaminB3', 1), 'niacin equivalent': ('vitaminB3', 1), 'pantothenate': ('vitaminB5', 1),
    'vitamin b6': ('vitaminB6', 1), 'vitamin b12': ('vitaminB12', 1), 'folate': ('folate', 1), 'biotin': ('biotin', 1), 'vitamin c': ('vitaminC', 1),
}

def col_index(cell_ref):
    value = 0
    for char in re.match(r'[A-Z]+', cell_ref).group(0): value = value * 26 + ord(char) - 64
    return value - 1

def xml_rows(zipped, sheet_path, strings):
    root = ET.fromstring(zipped.read(sheet_path))
    for row in root.findall('.//m:sheetData/m:row', NS):
        cells = {}
        for cell in row.findall('m:c', NS):
            value = cell.find('m:v', NS)
            raw = value.text if value is not None else ''
            if cell.attrib.get('t') == 's' and raw: raw = strings[int(raw)]
            cells[col_index(cell.attrib['r'])] = raw
        yield cells

def parse_value(raw):
    if not raw: return None
    if raw.strip().lower() in {'tr', 'n', 'nd', 'trace', '-'}: return None
    try: return float(raw)
    except (ValueError, TypeError): return None

def build():
    cache = Path(tempfile.gettempdir()) / 'cboard-cofid-2021.xlsx'
    if not cache.exists():
        with urllib.request.urlopen(URL, timeout=60) as response: cache.write_bytes(response.read())
    raw = cache.read_bytes()
    zipped = zipfile.ZipFile(io.BytesIO(raw))
    shared_root = ET.fromstring(zipped.read('xl/sharedStrings.xml'))
    strings = [''.join(t.text or '' for t in item.findall('.//m:t', NS)) for item in shared_root.findall('m:si', NS)]
    workbook = ET.fromstring(zipped.read('xl/workbook.xml'))
    relationships = ET.fromstring(zipped.read('xl/_rels/workbook.xml.rels'))
    targets = {rel.attrib['Id']: rel.attrib['Target'] for rel in relationships.findall('p:Relationship', NS)}
    sheets = {sheet.attrib['name']: 'xl/' + targets[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']].lstrip('/') for sheet in workbook.findall('.//m:sheets/m:sheet', NS)}
    foods = {}
    for sheet_name in ('1.3 Proximates', '1.4 Inorganics', '1.5 Vitamins', '1.8 (SFA per 100gFood)', '1.10 (MUFA per 100gFood)', '1.12 (PUFA per 100gFood)'):
        path = sheets.get(sheet_name)
        if not path: continue
        rows = xml_rows(zipped, path, strings)
        header = next(rows, {})
        codes = next(rows, {})
        names = next(rows, {})
        for row in rows:
            code = row.get(0, '').strip()
            name = row.get(1, '').strip()
            if not code or not name: continue
            food = foods.setdefault(code, {'id': code, 'name': name, 'nutrition': {}, 'unit': 'ml' if re.search(r'\b(beer|ale|stout|lager|wine|cider|spirits?|whisky|whiskey|vodka|gin|rum|brandy|liqueur)\b', name, re.I) else 'g'})
            if sheet_name in ('1.3 Proximates', '1.4 Inorganics', '1.5 Vitamins'):
                food['name'] = name
            for index in names:
                column_header = names.get(index, '')
                normalized = re.sub(r'\s*\([^)]*\)', '', column_header).strip().lower()
                nutrient, _ = ALIASES.get(column_header.strip().lower(), ALIASES.get(normalized, (None, None)))
                if not nutrient:
                    heading = header.get(index, '')
                    normalized_heading = re.sub(r'\s*\([^)]*\)', '', heading).strip().lower()
                    nutrient, _ = ALIASES.get(heading.strip().lower(), ALIASES.get(normalized_heading, (None, None)))
                if not nutrient: continue
                value = parse_value(row.get(index, ''))
                if value is not None and nutrient not in food['nutrition']:
                    food['nutrition'][nutrient] = value
    result = {'version': 1, 'source': 'UK CoFID', 'release': VERSION, 'license': 'Open Government Licence v3.0',
        'attribution': 'Contains public sector information licensed under the Open Government Licence v3.0. Source: McCance and Widdowson’s Composition of Foods Integrated Dataset 2021.',
        'sourceUrl': 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
        'sha256': hashlib.sha256(raw).hexdigest(), 'foods': sorted(foods.values(), key=lambda item: item['id'])}
    output = Path(__file__).resolve().parents[1] / 'public' / 'nutrition'
    output.mkdir(exist_ok=True)
    (output / 'cofid-foods.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"Built {len(result['foods'])} CoFID foods; {(output / 'cofid-foods.json').stat().st_size:,} bytes")

if __name__ == '__main__': build()
