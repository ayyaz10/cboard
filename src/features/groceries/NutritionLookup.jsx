import { useSavedFoods } from '../nutrition/useSavedFoods';
import { findSavedFoods, savedFoodNutrition } from '../nutrition/savedFoods.js';
import { normalizeFoodName } from '../nutrition/foodCatalog.js';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchNutrition, lookupBarcode } from '../../services/nutritionLookup';
import { BarcodeScanner } from './BarcodeScanner';
import { BarcodeImage } from './BarcodeImage';
import { NutritionLabel } from './NutritionLabel';
import { nutrients } from './groceryData';
import { searchNaturalFoods, searchCoFIDFoods, naturalPortionNutrition, nutritionForOnePortion, suggestedNaturalPortion } from '../../services/naturalFoods';
import { mergeNutritionByNutrient } from '../nutrition/sourceAdapters.js';
import { nutrientKeys } from '../nutrition/nutrients.js';

const externalSources = [
  ['branded', searchNutrition],
  ['USDA', searchNaturalFoods],
  ['CoFID', searchCoFIDFoods],
];

function sourceBadge(product) {
  const provider = product.source?.provider || '';
  if (provider === 'Saved food') return 'Saved';
  if (provider.includes('USDA')) return 'USDA';
  if (provider.includes('CoFID')) return 'CoFID';
  if (provider.includes('Food Facts')) return 'Branded';
  return provider || 'Saved';
}

function compactNutrition(product, portion = null) {
  const natural = ['USDA FoodData Central', 'UK CoFID'].includes(product.source?.provider);
  const unit = product.nutrition.unit || product.unit || 'g';
  const factor = natural && portion ? portion.grams / (product.nutrition.quantity || 100) : 1;
  const values = [
    ['calories', 'kcal'], ['protein', 'P'], ['carbs', 'C'], ['fat', 'F'], ['fiber', 'Fibre'],
  ];
  return values.filter(([key]) => Number.isFinite(product.nutrition[key])).map(([key, label]) => {
    const value = Number((product.nutrition[key] * factor).toFixed(1));
    return key === 'calories' ? `${Math.round(value)} kcal` : `${label} ${value}${key === 'fiber' ? ' g' : 'g'}`;
  }).join(' · ') || `Nutrition per ${product.nutrition.quantity || 100} ${unit}`;
}

function productValues(product, amountUnit, portionMode, portionIndex) {
  const natural = ['USDA FoodData Central', 'UK CoFID'].includes(product.source?.provider);
  const unit = product.nutrition.unit || product.unit || 'g';
  const portion = natural && portionIndex !== '' ? product.portions?.[Number(portionIndex)] : null;
  const selected = naturalPortionNutrition({
    ...product.nutrition,
    nutrientSources: product.nutrientSources || product.nutrition.nutrientSources,
    unit,
    source: { ...product.source, name: [product.name, product.brand].filter(Boolean).join(' · '), fetchedAt: new Date().toISOString() },
  }, portion || null);
  return portionMode === 'weight' || (natural && !portion) ? selected : nutritionForOnePortion(selected);
}

export function FoodPicker({ name = '', active, visible, onSelect, onManual, onClose, amountUnit, portionMode = 'unit', currentNutrition = null, allowLabelScan = true, scanUnits }) {
  const savedFoods = useSavedFoods(visible);
  const inputRef = useRef(null);
  const inputId = useId();
  const request = useRef(0);
  const [query, setQuery] = useState(name);
  const [results, setResults] = useState([]);
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  const [portionChoices, setPortionChoices] = useState({});
  const [retryKey, setRetryKey] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => { setQuery(name || ''); }, [name]);
  useEffect(() => {
    if (!visible || !active || window.matchMedia?.('(pointer: coarse)').matches) return;
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, [visible, active]);

  const localMatches = useMemo(() => {
    const recent = [...savedFoods.library].sort((left, right) => {
      const leftDate = left.origins.filter((origin) => /^\d{4}-\d{2}-\d{2}$/.test(origin)).sort().at(-1) || '';
      const rightDate = right.origins.filter((origin) => /^\d{4}-\d{2}-\d{2}$/.test(origin)).sort().at(-1) || '';
      return rightDate.localeCompare(leftDate) || left.item.name.localeCompare(right.item.name);
    });
    const found = query.trim() ? findSavedFoods(savedFoods.library, query, 24) : recent.slice(0, 8);
    return found.map((entry) => ({
      ...entry.item,
      nutrition: savedFoodNutrition(entry.item),
      code: `saved:${entry.key}`,
      source: { ...entry.item.source, provider: 'Saved food', name: entry.item.name },
      _saved: true,
      _origins: entry.origins,
    })).filter((food) => food.nutrition);
  }, [savedFoods.library, query]);

  useEffect(() => {
    const id = ++request.current;
    const text = query.trim();
    setResults([]);
    setRemoteError(false);
    if (text.length < 2) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const seen = new Set(localMatches.map((food) => normalizeFoodName(food.name)));
      let failed = false;
      await Promise.all(externalSources.map(async ([, search]) => {
        try {
          const found = await search(text);
          if (id !== request.current) return;
          const fresh = found.filter((food) => {
            const key = normalizeFoodName(food.name);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (fresh.length) setResults((previous) => [...previous, ...fresh]);
        } catch { failed = true; }
      }));
      if (id !== request.current) return;
      setRemoteError(failed);
      setSearching(false);
    }, 280);
    return () => { window.clearTimeout(timer); request.current += 1; };
  }, [query, retryKey, localMatches]);

  function chooseBarcodeResult(product) {
    if (product) onSelect(productValues(product, amountUnit, portionMode, ''));
  }

  async function searchCode(code) {
    setBarcode(code);
    setBarcodeError('');
    setBarcodeBusy(true);
    try {
      const found = await lookupBarcode(code);
      if (!found.length) throw new Error('No food found for that barcode. Try the label scan or add it manually.');
      setBarcodeResults(found);
      setBarcodeOpen(false);
      setQuery('');
    } catch (error) { setBarcodeError(error.message || 'Barcode lookup failed.'); }
    finally { setBarcodeBusy(false); }
  }

  function choose(product) {
    if (product._saved) { onSelect(product.nutrition); return; }
    onSelect(productValues(product, amountUnit, portionMode, portionChoices[product.code] ?? suggestedNaturalPortion(product, name, amountUnit)));
  }

  function enrich(product) {
    const reference = productValues(product, amountUnit, 'weight', '');
    const quantity = Number(currentNutrition?.quantity ?? currentNutrition?.basis);
    if (!(quantity > 0) || currentNutrition?.unit !== reference.unit) return;
    const factor = quantity / reference.quantity;
    const scaled = { ...reference, quantity, ...Object.fromEntries(nutrientKeys.map((key) => [key, reference[key] == null ? null : reference[key] * factor])) };
    const merged = mergeNutritionByNutrient(currentNutrition, scaled, { currentSource: currentNutrition.source, incomingSources: scaled.nutrientSources });
    onSelect({ ...currentNutrition, ...merged.nutrition, nutrientSources: merged.nutrientSources, quantity, unit: currentNutrition.unit, source: { ...currentNutrition.source, referenceSource: reference.source } });
  }

  const canEnrich = (product) => ['USDA FoodData Central', 'UK CoFID'].includes(product.source?.provider)
    && currentNutrition && currentNutrition.unit === (product.nutrition.unit || product.unit || 'g')
    && nutrientKeys.some((key) => currentNutrition[key] == null && product.nutrition[key] != null);

  const showRecent = !query.trim() && localMatches.length > 0;
  const otherResults = barcodeResults.length ? barcodeResults : results;
  const visibleResults = [...localMatches, ...otherResults];
  const titleForManual = query.trim() || name.trim();
  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (barcodeOpen || labelOpen) { setBarcodeOpen(false); setLabelOpen(false); }
      else onClose?.();
    }
    if (event.key === 'ArrowDown' && visibleResults.length) { event.preventDefault(); setActiveIndex((index) => Math.min(index < 0 ? 0 : index + 1, visibleResults.length - 1)); }
    if (event.key === 'ArrowUp' && visibleResults.length) { event.preventDefault(); setActiveIndex((index) => Math.max(index < 0 ? visibleResults.length - 1 : index - 1, 0)); }
    if (event.key === 'Enter' && visibleResults.length) { event.preventDefault(); choose(visibleResults[activeIndex < 0 ? 0 : Math.min(activeIndex, visibleResults.length - 1)]); }
  };

  return <div className="g-food-picker" aria-label="Food picker">
    <div className="g-food-picker-top">
      <label className="g-food-search-label" htmlFor={inputId}>Search foods</label>
      <input ref={inputRef} id={inputId} type="search" autoComplete="off" placeholder="Search foods..." value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); setBarcodeOpen(false); setBarcodeResults([]); }} onKeyDown={handleKeyDown} />
      <div className="g-food-picker-actions">
        <button type="button" onClick={() => { setBarcodeOpen((open) => !open); setLabelOpen(false); }}>Scan barcode</button>
        {onManual && <button type="button" onClick={() => onManual(titleForManual)}>Add manually</button>}
        {allowLabelScan && <button type="button" onClick={() => { setLabelOpen((open) => !open); setBarcodeOpen(false); }}>Scan nutrition label</button>}
      </div>
    </div>
    {barcodeOpen && <div className="g-picker-tool">
      {visible && <BarcodeScanner onClose={() => setBarcodeOpen(false)} onCode={searchCode} />}
      <BarcodeImage onCode={searchCode} />
      <label>Barcode number<input inputMode="numeric" value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchCode(barcode); } }} /></label>
      <button type="button" disabled={barcodeBusy || !barcode.trim()} onClick={() => searchCode(barcode)}>{barcodeBusy ? 'Looking up...' : 'Look up barcode'}</button>
      {barcodeError && <p role="alert">{barcodeError}</p>}
    </div>}
    {labelOpen && <div className="g-picker-tool"><NutritionLabel basisUnits={scanUnits} key={name} current={currentNutrition} onSelect={onSelect} /></div>}

    {!query.trim() && <div className="g-food-result-group">
      <h3>{showRecent ? 'Recent foods' : 'My foods'}</h3>
      {savedFoods.loading && <p role="status">Loading saved foods...</p>}
      {localMatches.map((product, index) => <ResultRow key={product.code} product={product} active={index === activeIndex} onChoose={() => choose(product)} />)}
      {!savedFoods.loading && !localMatches.length && <p className="g-food-empty">Type to search foods. Your saved foods will appear here.</p>}
    </div>}
    {(query.trim().length >= 2 || barcodeResults.length > 0) && <>
      <div className="g-food-result-group">
        {localMatches.length > 0 && <h3>My foods</h3>}
        {localMatches.map((product, index) => <ResultRow key={product.code} product={product} active={index === activeIndex} onChoose={() => choose(product)} />)}
      </div>
      <div className="g-food-result-group">
        {otherResults.length > 0 && <h3>{barcodeResults.length ? 'Barcode result' : 'Other results'}</h3>}
        {otherResults.map((product, index) => <ResultRow key={`${product.source?.provider}:${product.code}`} product={product} active={localMatches.length + index === activeIndex} portionChoices={portionChoices} onPortion={(value) => setPortionChoices((previous) => ({ ...previous, [product.code]: value }))} onChoose={() => choose(product)} onEnrich={canEnrich(product) ? () => enrich(product) : null} amountUnit={amountUnit} />)}
        {!barcodeResults.length && searching && <p className="g-picker-status" role="status">Searching other foods...</p>}
        {remoteError && <p className="g-picker-status" role="status">Some online results could not load. <button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry</button></p>}
        {!searching && !localMatches.length && !otherResults.length && !remoteError && <p className="g-food-empty">No foods found for “{query.trim()}”.</p>}
        {query.trim() && onManual && <button type="button" className="g-food-add-query" onClick={() => onManual(query.trim())}>+ Add “{query.trim()}” manually</button>}
      </div>
      {otherResults.length > 0 && <small className="g-food-attribution">Sources: {otherResults.some((food) => food.source?.provider === 'Open Food Facts') && <><a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> (ODbL) · </>}{otherResults.some((food) => food.source?.provider === 'USDA FoodData Central') && <><a href="https://fdc.nal.usda.gov/" target="_blank" rel="noreferrer">USDA FoodData Central</a> (CC0) · </>}{otherResults.some((food) => food.source?.provider === 'UK CoFID') && <><a href="https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid" target="_blank" rel="noreferrer">UK CoFID</a> (OGL).</>}</small>}
    </>}
    {savedFoods.error && <p className="g-picker-status" role="status">{savedFoods.error}</p>}
    {savedFoods.loading && query.trim() && !localMatches.length && <p className="g-picker-status" role="status">Checking your saved foods...</p>}
  </div>;
}

export const NutritionLookup = FoodPicker;

function ResultRow({ product, onChoose, onEnrich, amountUnit, portionChoices, onPortion, active = false }) {
  const natural = ['USDA FoodData Central', 'UK CoFID'].includes(product.source?.provider);
  const portions = natural && product.portions?.length ? product.portions : [];
  const suggested = suggestedNaturalPortion(product, product.name, amountUnit);
  const selectedPortion = portionChoices?.[product.code] ?? suggested;
  const chosenPortion = selectedPortion !== '' ? portions[Number(selectedPortion)] : null;
  const detailFactor = natural && chosenPortion ? chosenPortion.grams / (product.nutrition.quantity || 100) : 1;
  const visibleNutrients = nutrients.filter(([key]) => Number.isFinite(product.nutrition?.[key]));
  const quantity = product.nutrition?.quantity || 100;
  const unit = product.nutrition?.unit || product.unit || 'g';
  return <article className={`g-food-result${active ? ' is-active' : ''}`}>
    <button type="button" className="g-food-result-main" onClick={onChoose} aria-label={`Use ${product.name}, ${compactNutrition(product)}`}>
      <strong>{product.name}</strong>
      <span>{compactNutrition(product, selectedPortion !== '' ? portions[Number(selectedPortion)] : null)}</span>
      <small>{sourceBadge(product)} · {chosenPortion ? `per 1 ${chosenPortion.label}` : `per ${quantity} ${unit}`}</small>
    </button>
    {portions.length > 0 && <label className="g-food-portion">Portion
      <select value={selectedPortion} onChange={(event) => onPortion(event.target.value)}>
        <option value="">Use weighed amount</option>
        {portions.map((portion, index) => <option key={`${portion.label}:${index}`} value={index}>{portion.label} (~{Number(portion.grams.toFixed(1))} g)</option>)}
      </select>
    </label>}
    {onEnrich && <button type="button" className="g-food-add-query" onClick={onEnrich}>Fill missing nutrition values</button>}
    {visibleNutrients.length > 5 && <details className="g-food-more"><summary>More nutrition</summary><dl>{visibleNutrients.slice(5).map(([key, label, suffix = '']) => <div key={key}><dt>{label}</dt><dd>{Number((product.nutrition[key] * detailFactor).toFixed(1))} {suffix}</dd></div>)}</dl></details>}
  </article>;
}
