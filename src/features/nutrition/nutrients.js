// Canonical nutrition registry. Numeric values remain on each food's existing
// `nutrition` object for backwards compatibility; source attribution lives in
// the sibling `nutrientSources` map and is keyed by these stable IDs.
const definitions = [
  ['calories', 'Calories', 'kcal', 'energy', ['energy kcal', 'calories', 'calorific value']],
  ['protein', 'Protein', 'g', 'macros', ['protein', 'proteins', 'total protein', 'proteinas']],
  ['carbs', 'Carbohydrates', 'g', 'macros', ['carbohydrate', 'carbohydrates', 'total carbohydrate', 'total carbohydrates', 'carbs', 'hidratos de carbono', 'glucidos']],
  ['fat', 'Fat', 'g', 'macros', ['fat', 'total fat', 'lipid', 'lipids', 'total lipid', 'total lipids', 'lipidos', 'grasa', 'grasa lipidos']],
  ['fiber', 'Fibre', 'g', 'macros', ['fibre', 'fiber', 'dietary fibre', 'dietary fiber', 'total dietary fibre', 'total dietary fiber', 'fibre dietary', 'fiber dietary', 'fibra', 'fibra alimentaria']],
  ['energyKJ', 'Energy', 'kJ', 'energy', ['kilojoules', 'energy kj', 'energia', 'valor energetico']],
  ['sugars', 'Sugars', 'g', 'macros', ['sugar', 'sugars', 'total sugar', 'total sugars', 'of which sugar', 'of which sugars', 'total sugar content', 'azucares', 'acucares', 'acares', 'dos quais acucares']],
  ['saturatedFat', 'Saturated fat', 'g', 'fat', ['saturated fat', 'total saturated fat', 'saturates', 'saturated fatty acid', 'saturated fatty acids', 'saturadas', 'saturados', 'dos quais saturados']],
  ['monounsaturatedFat', 'Monounsaturated fat', 'g', 'fat', ['monounsaturated fat', 'monounsaturates', 'monounsaturated fatty acid', 'monounsaturated fatty acids', 'mufa']],
  ['polyunsaturatedFat', 'Polyunsaturated fat', 'g', 'fat', ['polyunsaturated fat', 'polyunsaturates', 'polyunsaturated fatty acid', 'polyunsaturated fatty acids', 'pufa']],
  ['transFat', 'Trans fat', 'g', 'fat', ['trans fat', 'trans fatty acid', 'trans fatty acids']],
  ['omega3', 'Omega-3', 'g', 'fat', ['omega 3', 'omega-3', 'n-3 fatty acids']],
  ['omega6', 'Omega-6', 'g', 'fat', ['omega 6', 'omega-6', 'n-6 fatty acids']],
  ['salt', 'Salt', 'g', 'other', ['salt', 'sal']],
  ['sodium', 'Sodium', 'mg', 'minerals', ['sodium', 'na']],
  ['water', 'Water', 'g', 'other', ['water', 'moisture']],
  ['choline', 'Choline', 'mg', 'bVitamins', ['choline']],
  ['cholesterol', 'Cholesterol', 'mg', 'other', ['cholesterol', 'total cholesterol']],
  ['vitaminA', 'Vitamin A', 'µg', 'vitamins', ['vitamin a', 'vitamin a rae', 'rae', 'retinol', 'retinol activity equivalents']],
  ['vitaminC', 'Vitamin C', 'mg', 'vitamins', ['vitamin c', 'ascorbic acid']],
  ['vitaminD', 'Vitamin D', 'µg', 'vitamins', ['vitamin d', 'vitamin d2', 'vitamin d3', 'vitamin d d2 d3']],
  ['vitaminE', 'Vitamin E', 'mg', 'vitamins', ['vitamin e', 'alpha tocopherol', 'alpha tocopherol vitamin e']],
  ['vitaminK', 'Vitamin K', 'µg', 'vitamins', ['vitamin k', 'phylloquinone']],
  ['vitaminB1', 'Thiamin (B1)', 'mg', 'bVitamins', ['thiamin', 'thiamine', 'vitamin b1']],
  ['vitaminB2', 'Riboflavin (B2)', 'mg', 'bVitamins', ['riboflavin', 'vitamin b2']],
  ['vitaminB3', 'Niacin (B3)', 'mg', 'bVitamins', ['niacin', 'vitamin b3']],
  ['vitaminB5', 'Pantothenic acid (B5)', 'mg', 'bVitamins', ['pantothenic acid', 'vitamin b5']],
  ['vitaminB6', 'Vitamin B6', 'mg', 'bVitamins', ['vitamin b6', 'pyridoxine', 'pyridoxal', 'pyridoxamine']],
  ['biotin', 'Biotin (B7)', 'µg', 'bVitamins', ['biotin', 'vitamin b7']],
  ['folate', 'Folate (B9)', 'µg', 'bVitamins', ['folate', 'folic acid', 'vitamin b9', 'vitamin b9 folate']],
  ['vitaminB12', 'Vitamin B12', 'µg', 'bVitamins', ['vitamin b12', 'cobalamin', 'cyanocobalamin', 'vitamin b12 cobalamin']],
  ['calcium', 'Calcium', 'mg', 'minerals', ['calcium', 'ca']],
  ['iron', 'Iron', 'mg', 'minerals', ['iron', 'fe']],
  ['magnesium', 'Magnesium', 'mg', 'minerals', ['magnesium', 'mg']],
  ['phosphorus', 'Phosphorus', 'mg', 'minerals', ['phosphorus']],
  ['potassium', 'Potassium', 'mg', 'minerals', ['potassium', 'k']],
  ['zinc', 'Zinc', 'mg', 'minerals', ['zinc', 'zn']],
  ['copper', 'Copper', 'mg', 'minerals', ['copper']],
  ['manganese', 'Manganese', 'mg', 'minerals', ['manganese']],
  ['selenium', 'Selenium', 'µg', 'minerals', ['selenium']],
  ['iodine', 'Iodine', 'µg', 'minerals', ['iodine']],
];

export const NUTRIENT_REGISTRY = definitions.map(([id, label, canonicalUnit, group, aliases]) => ({
  id, label, canonicalUnit, expectedUnits: [canonicalUnit], family: group, group, aliases, scientificAliases: aliases.filter(alias => /cobalamin|cyanocobalamin|thiamin|thiamine|riboflavin|niacin|pantothenic|pyridox|folate|folic acid|tocopherol|retinol|ascorbic|phylloquinone/i.test(alias)), detailed: true,
  defaultSummary: ['calories', 'protein', 'carbs', 'fat', 'fiber'].includes(id),
  precision: canonicalUnit === 'kcal' || canonicalUnit === 'kJ' ? 0 : 1,
}));
export const NUTRIENTS = NUTRIENT_REGISTRY.map(({ id, label, canonicalUnit }) => [id, label, canonicalUnit]);
export const nutrientKeys = NUTRIENT_REGISTRY.map(({ id }) => id);
export const nutrientById = Object.fromEntries(NUTRIENT_REGISTRY.map((entry) => [entry.id, entry]));
export const nutrientByAlias = new Map(NUTRIENT_REGISTRY.flatMap((entry) => entry.aliases.map(alias => [alias.toLowerCase(), entry])));

const aliasRows = NUTRIENT_REGISTRY.flatMap(entry => [entry.label, entry.id, ...entry.aliases].map(alias => ({entry, alias, normalized: normalizeNutrientLabel(alias)})));
const ignoredSemanticWords = new Set(['total','dietary','of','which','content','the','and','for','de','las','los','dos','quais','das','cuales']);
const ignoredFuzzyWords = new Set([...ignoredSemanticWords,'vitamin','vitamins','acid','fatty','acids']);
const normalizeOcrConfusions = text => text.replace(/0/g,'o').replace(/1/g,'i').replace(/5/g,'s');
const editDistance = (left,right,max=1) => {
  if(Math.abs(left.length-right.length)>max)return max+1;
  let prior=Array.from({length:right.length+1},(_,i)=>i);
  for(let i=1;i<=left.length;i++){
    const row=[i];let minimum=i;
    for(let j=1;j<=right.length;j++){
      row[j]=Math.min(row[j-1]+1,prior[j]+1,prior[j-1]+(left[i-1]===right[j-1]?0:1));minimum=Math.min(minimum,row[j]);
    }
    if(minimum>max)return max+1;prior=row;
  }
  return prior[right.length];
};
const normalizedUnit = unit => String(unit||'').toLowerCase().replace(/[µμ]/g,'u').replace(/^mcg$/,'ug');
const categoryMatches = (entry,category) => !category?false:category==='vitamins'
  ? ['vitamins','bvitamins'].includes(entry.group.toLowerCase())
  : entry.group.toLowerCase()===category;

export function normalizeNutrientLabel(value) {
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[‐‑‒–—−]/g,' ').replace(/^[^\p{L}\p{N}]+/u,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
}

function resolveExact(label, context={}) {
  const normalized=normalizeNutrientLabel(label);
  if(!normalized)return null;
  const allTokens=normalized.split(' '), semantic=allTokens.filter(token=>!ignoredSemanticWords.has(token));
  const semanticSet=new Set(semantic);
  let candidates=aliasRows.filter(row=>{
    if(row.normalized===normalized)return true;
    const aliasTokens=row.normalized.split(' ').filter(token=>!ignoredSemanticWords.has(token));
    return aliasTokens.length>0&&aliasTokens.every(token=>semanticSet.has(token))&&semantic.every(token=>aliasTokens.includes(token));
  });
  if(!candidates.length&&semantic.length){
    const ids=[...new Set(aliasRows.map(row=>row.entry.id))].filter(id=>{
      const terms=new Set(aliasRows.filter(row=>row.entry.id===id).flatMap(row=>row.normalized.split(' ').filter(token=>!ignoredSemanticWords.has(token))));
      return semantic.every(token=>terms.has(token));
    });
    if(ids.length===1)candidates=aliasRows.filter(row=>row.entry.id===ids[0]);
  }
  if(!candidates.length)return null;
  const ids=[...new Set(candidates.map(item=>item.entry.id))];
  const category=String(context.category||'').toLowerCase();
  const unit=normalizedUnit(context.unit);
  const ranked=ids.map(id=>{
    const entry=nutrientById[id];
    const best=candidates.filter(item=>item.entry.id===id).sort((a,b)=>b.normalized.length-a.normalized.length)[0];
    const categoryMatch=categoryMatches(entry,category);
    const unitMatch=unit&&entry.expectedUnits.some(value=>normalizedUnit(value)===unit);
    return {entry,best,categoryMatch,unitMatch};
  }).sort((a,b)=>Number(b.categoryMatch)-Number(a.categoryMatch)||Number(b.unitMatch)-Number(a.unitMatch)||b.best.normalized.length-a.best.normalized.length);
  if(ranked.length>1&&ranked[0].categoryMatch===ranked[1].categoryMatch&&ranked[0].unitMatch===ranked[1].unitMatch&&ranked[0].best.normalized.length===ranked[1].best.normalized.length)return null;
  const {entry,best}=ranked[0];
  const exactCanonical=normalized===normalizeNutrientLabel(entry.label)||normalized===normalizeNutrientLabel(entry.id);
  const scientific=entry.scientificAliases.some(alias=>normalizeNutrientLabel(alias)===best.normalized);
  const matchType=exactCanonical?'canonical':scientific?'scientificAlias':normalized.includes(' ')&&best.normalized!==normalized?'token':'alias';
  return {nutrientId:entry.id,confidence:'high',score:1,matchType,matchedAlias:best.alias,displayName:entry.label,canonicalUnit:entry.canonicalUnit,family:entry.group};
}

export function resolveCanonicalNutrient(rawLabel, context={}) {
  const exact=resolveExact(rawLabel,context);
  if(exact)return {...exact,rawLabel:String(rawLabel??'')};
  const normalized=normalizeNutrientLabel(rawLabel);
  const tokens=normalized.split(' ').filter(token=>token&&!ignoredFuzzyWords.has(token));
  const category=String(context.category||'').toLowerCase(),unit=normalizedUnit(context.unit);
  const tokenMatches=[];
  for(const row of aliasRows){
    const aliasTokens=row.normalized.split(' ').filter(token=>token&&!ignoredSemanticWords.has(token));
    if(!aliasTokens.length)continue;
    const fuzzyToken=tokens.find(token=>aliasTokens.some(alias=>{
      const ocrToken=normalizeOcrConfusions(token),ocrAlias=normalizeOcrConfusions(alias);
      return token.length>=4&&(token===alias||ocrToken===ocrAlias||editDistance(ocrToken,ocrAlias,1)===1);
    }));
    if(fuzzyToken)tokenMatches.push({entry:row.entry,alias:row.alias,token:fuzzyToken,score:fuzzyToken.length<5?0.65:0.78});
  }
  const byId=new Map();
  for(const match of tokenMatches){const old=byId.get(match.entry.id);if(!old||match.score>old.score)byId.set(match.entry.id,match);}
  let candidates=[...byId.values()];
  if(category){const matching=candidates.filter(item=>categoryMatches(item.entry,category));if(matching.length)candidates=matching;}
  if(unit){const matching=candidates.filter(item=>item.entry.expectedUnits.some(value=>normalizedUnit(value)===unit));if(matching.length)candidates=matching;}
  candidates.sort((a,b)=>b.score-a.score||b.token.length-a.token.length);
  if(!candidates.length||candidates.length>1&&candidates[0].score===candidates[1].score&&candidates[0].token.length===candidates[1].token.length)return null;
  const best=candidates[0];
  return {nutrientId:best.entry.id,confidence:'medium',score:best.score,matchType:'fuzzy',matchedAlias:best.alias,displayName:best.entry.label,canonicalUnit:best.entry.canonicalUnit,family:best.entry.group,rawLabel:String(rawLabel??'')};
}

export function matchCanonicalNutrientPrefix(text, context={}) {
  const source=String(text??'');
  const tokens=[...source.matchAll(/[\p{L}\p{N}µμ]+/gu)];
  let best=null;
  for(const token of tokens){
    if(token.index>180)break;
    if(/^\d/.test(token[0])&&!/^[a-z]+\d+$/i.test(token[0]))break;
    if(best&&/^[oils]$/i.test(token[0])&&/^\s*[.,]?\s*\d/i.test(source.slice(token.index+token[0].length)))break;
    let end=token.index+token[0].length;
    const closing=source.slice(end).match(/^\s*\)/);
    if(closing)end+=closing[0].length;
    const result=resolveCanonicalNutrient(source.slice(0,end),context);
    if(result&&(result.matchType!=='fuzzy'||tokens.indexOf(token)<3))best={...result,labelEnd:end,rawLabel:source.slice(0,end)};
  }
  return best;
}

export const validNutrient = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export const cleanNutrients = (values = {}) => Object.fromEntries(nutrientKeys.map(key => [key, validNutrient(values?.[key]) ? values[key] : null]));
export function nutritionCoverage(values = {}, keys = nutrientKeys) {
  const known = keys.filter(key => validNutrient(values?.[key])).length;
  return { known, total: keys.length, missing: keys.length - known, percent: keys.length ? Math.round(known / keys.length * 100) : 100 };
}

export function cleanNutrientSources(sources = {}) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return {};
  return Object.fromEntries(nutrientKeys.flatMap(key => {
    const source = sources[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
    return [[key, {
      sourceType: String(source.sourceType || source.provider || 'unknown').slice(0, 80),
      sourceId: source.sourceId == null ? '' : String(source.sourceId).slice(0, 200),
      sourceName: String(source.sourceName || source.name || '').slice(0, 300),
      confidence: ['high', 'medium', 'low'].includes(source.confidence) ? source.confidence : 'medium',
      estimated: source.estimated === true,
      ...(source.derived === true ? { derived: true } : {}),
      ...(source.unit ? { sourceUnit: String(source.unit).slice(0, 20) } : {}),
      ...(source.convention ? { convention: String(source.convention).slice(0, 80) } : {}),
    }]];
  }));
}

export function nutrientSourcesForValues(values = {}, source = {}) {
  const provider = String(source?.provider || 'Manual');
  const normalized = provider.toLowerCase();
  const type = normalized.includes('cofid') ? 'cofid' : normalized.includes('usda') ? 'usda'
    : normalized.includes('food facts') || normalized.includes('open food') ? 'openfoodfacts'
      : normalized.includes('ocr') || normalized.includes('label') ? 'label' : normalized.includes('manual') ? 'manual'
        : normalized.includes('ai') ? 'ai' : normalized;
  const estimated = ['cofid', 'usda', 'ai'].includes(type);
  return Object.fromEntries(nutrientKeys.filter(key => validNutrient(values?.[key])).map(key => [key, {
    sourceType: type, sourceId: String(source?.code || ''), sourceName: String(source?.name || provider),
    confidence: type === 'ai' ? 'low' : estimated ? 'medium' : 'high', estimated,
  }]));
}

// Convert supported mass units only. Unitless and unlike units stay unknown.
export function convertNutrientValue(value, fromUnit, toUnit) {
  if (!validNutrient(value) || !fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return value;
  const factors = { g: 1, mg: 1e-3, µg: 1e-6, 'μg': 1e-6, mcg: 1e-6 };
  const from = factors[String(fromUnit).toLowerCase()];
  const to = factors[String(toUnit).toLowerCase()];
  if (from == null || to == null) return null;
  return value * from / to;
}

export function offNutrients(values = {}) {
  const fields = {
    calories: ['energy-kcal_100g', 1], energyKJ: ['energy-kj_100g', 1], protein: ['proteins_100g', 1],
    carbs: ['carbohydrates_100g', 1], fat: ['fat_100g', 1], fiber: ['fiber_100g', 1], sugars: ['sugars_100g', 1],
    saturatedFat: ['saturated-fat_100g', 1], monounsaturatedFat: ['monounsaturated-fat_100g', 1],
    polyunsaturatedFat: ['polyunsaturated-fat_100g', 1], transFat: ['trans-fat_100g', 1], omega3: ['omega-3-fat_100g', 1], omega6: ['omega-6-fat_100g', 1],
    salt: ['salt_100g', 1], sodium: ['sodium_100g', 1000], water: ['water_100g', 1], choline: ['choline_100g', 1000], cholesterol: ['cholesterol_100g', 1000],
    vitaminA: ['vitamin-a_100g', 1e6], vitaminC: ['vitamin-c_100g', 1000], vitaminD: ['vitamin-d_100g', 1e6], vitaminE: ['vitamin-e_100g', 1000], vitaminK: ['vitamin-k_100g', 1e6],
    vitaminB1: ['vitamin-b1_100g', 1000], vitaminB2: ['vitamin-b2_100g', 1000], vitaminB3: ['vitamin-pp_100g', 1000], vitaminB5: ['pantothenic-acid_100g', 1000], vitaminB6: ['vitamin-b6_100g', 1000], biotin: ['biotin_100g', 1e6], folate: ['folates_100g', 1e6], vitaminB12: ['vitamin-b12_100g', 1e6],
    calcium: ['calcium_100g', 1000], iron: ['iron_100g', 1000], magnesium: ['magnesium_100g', 1000], phosphorus: ['phosphorus_100g', 1000], potassium: ['potassium_100g', 1000], zinc: ['zinc_100g', 1000], copper: ['copper_100g', 1000], manganese: ['manganese_100g', 1000], selenium: ['selenium_100g', 1e6], iodine: ['iodine_100g', 1e6],
  };
  return Object.fromEntries(nutrientKeys.map(key => {
    const [field, factor] = fields[key];
    const value = values[field];
    return [key, validNutrient(value) ? value * factor : null];
  }));
}
