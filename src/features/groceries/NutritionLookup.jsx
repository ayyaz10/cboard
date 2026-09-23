import { useEffect, useRef, useState } from "react";
import { searchNutrition, lookupBarcode } from "../../services/nutritionLookup";
import { BarcodeScanner } from "./BarcodeScanner";
import { NutritionLabel } from "./NutritionLabel";
import { nutrients } from "./groceryData";
import { searchNaturalFoods, naturalPortionNutrition, nutritionForOnePortion, suggestedNaturalPortion } from '../../services/naturalFoods';

export function NutritionLookup({ name, active, visible, onSelect, amountUnit, portionMode = 'unit' }) {
  const [mode, setMode] = useState("name");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState(name);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [basis, setBasis] = useState({});
  const [portions, setPortions] = useState({});
  const request = useRef(0);
  const searched = useRef("");
  async function lookup(text, byBarcode = false) {
    const id = ++request.current;
    setBusy(true); setError(""); setResults(null); setBasis({}); setPortions({});
    try {
      const rows = await (byBarcode ? lookupBarcode(text) : mode === 'natural' ? searchNaturalFoods(text) : searchNutrition(text));
      if (id === request.current) setResults(rows);
    } catch (err) {
      if (id === request.current) setError(err.message);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    setQuery(name); setResults(null); setError(""); setBusy(false); setScanning(false); setBarcode("");
    request.current += 1;
    searched.current = "";
  }, [name]);
  useEffect(() => {
    if (active && ['name', 'natural'].includes(mode) && name.trim().length >= 2 && searched.current !== `${mode}:${name}`) {
      searched.current = `${mode}:${name}`;
      lookup(name);
    }
  }, [active, name, mode]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { if (!visible) setScanning(false); }, [visible]);
  return <div className="g-nutrition-lookup">
    <div className="g-actions" aria-label="Nutrition lookup method">
      {[["name", "Branded products"], ["natural", "Natural foods"], ["barcode", "Scan barcode"], ["photo", "Label photo"]].map(([key, title]) =>
        <button type="button" key={key} aria-pressed={mode === key} onClick={() => {
          request.current++; setMode(key); setScanning(false); setBusy(false); setResults(null); setError("");
        }}>{title}</button>)}
    </div>
    {mode === "photo" && <NutritionLabel key={name} onSelect={onSelect} />}
    {mode === "barcode" && <div>
      {scanning && visible && <BarcodeScanner onClose={() => setScanning(false)} onCode={(code) => { setScanning(false); setBarcode(code); lookup(code, true); }} />}
      {!scanning && <button type="button" onClick={() => setScanning(true)}>Start camera</button>}
      <div className="g-tools">
        <label>Barcode number<input inputMode="numeric" value={barcode} onChange={(e) => { request.current++; setBusy(false); setResults(null); setBarcode(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(barcode, true); } }} /></label>
        <button type="button" disabled={busy || !barcode.trim()} onClick={() => lookup(barcode, true)}>Look up barcode</button>
      </div>
    </div>}
    {['name', 'natural'].includes(mode) && <>

    <div className="g-tools">
      <label>{mode === 'natural' ? 'Natural food name' : 'Product name or brand'}
        <input value={query} maxLength={120} onChange={(e) => {
          setQuery(e.target.value); setResults(null); setError("");
          request.current += 1; setBusy(false);
        }} onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); lookup(query); }
        }} />
      </label>
      <button type="button" disabled={busy || query.trim().length < 2} onClick={() => lookup(query)}>
        {busy ? "Searching..." : "Find nutrition"}
      </button>
    </div>
    <p className="g-hint">{mode === 'natural' ? 'USDA reference foods: try banana, apple, raw cashews or cooked egg. Match raw/cooked and salted/unsalted. Values describe the edible portion; peel, shells and other refuse are excluded.' : 'Choose the matching food, brand and preparation (for example, dry or cooked rice). Values are for the product as sold.'}</p>
    </>}
    {busy && <p role="status">Looking up nutrition...</p>}
    {error && <p role="alert">{error}</p>}
    {results?.length === 0 && <p role="status">{mode === "barcode" ? "No nutrition record found for this barcode. Try a label photo or search by name." : 'No matching nutrition records found. Try a shorter name (for example, "cheddar") or add the brand.'}</p>}
    {results?.map((product) => {
      const unit = basis[product.code] || product.nutrition.unit;
      const natural = product.source.provider === 'USDA FoodData Central';
      const suggestedPortion = suggestedNaturalPortion(product, name, amountUnit);
      const portionIndex = Object.hasOwn(portions, product.code) ? portions[product.code] : suggestedPortion;
      const portion = product.portions?.[portionIndex];
      const allowPortion = !amountUnit || !/^(g|grams?|kg|kilograms?|mg|ml|millilitres?|milliliters?|l|litres?|liters?|oz|lb)$/i.test(amountUnit.trim());
      const displayScale = natural && allowPortion && portion ? portion.grams / product.nutrition.quantity : 1;
      return <div className="g-nutrition-result" key={product.code}>
        <strong>{product.name}</strong>
        <p>{[product.brand, product.pack].filter(Boolean).join(" / ")}</p>
        <small>{nutrients.map(([key, label, suffix]) => `${label}: ${product.nutrition[key] == null ? "unknown" : `${Number((product.nutrition[key] * displayScale).toFixed(2))} ${suffix}`}`).join(" / ")}</small>
        <p>{natural && allowPortion && portion ? `Per 1 ${portion.label} (~${Number(portion.grams.toFixed(2))} g edible portion)` : `Per 100 ${unit || "g or ml (choose below)"}`}</p>
        {!natural && <label>Nutrition basis (auto-selected; change if needed)
          <select value={unit || ""} onChange={(e) => setBasis({ ...basis, [product.code]: e.target.value })}>
            <option value="">Choose g or ml</option><option value="g">100 g</option><option value="ml">100 ml</option>
          </select>
        </label>}
        {natural && allowPortion && product.portions.length > 0 && <label>{amountUnit ? `Portion used for one ${amountUnit}` : 'Portion size (estimated)'}
          <select value={portionIndex} onChange={(event) => setPortions({ ...portions, [product.code]: event.target.value })}>
            <option value="">Use weighed grams</option>
            {product.portions.map((value, index) => <option key={index} value={index}>{value.label} (~{Number(value.grams.toFixed(2))} g per unit)</option>)}
          </select>
        </label>}
        {natural && <p className="g-hint">{portion ? `Estimated portion: ${portion.label}, ${portion.grams} g. Your actual food may weigh more or less.` : 'Use an actual edible weight for the best portion calculation. Size estimates are available only where USDA provides a portion weight.'} Nutrients not reported by USDA stay unknown.</p>}
        <div className="g-actions">
          <button type="button" disabled={!unit} onClick={() => {
            const selected = naturalPortionNutrition({ ...product.nutrition, unit, source: { ...product.source, name: [product.name, product.brand].filter(Boolean).join(' · '), fetchedAt: new Date().toISOString() } }, allowPortion ? portion : null);
            onSelect(portionMode === 'weight' ? selected : nutritionForOnePortion(selected));
            setResults(null);
          }}>Use these values</button>
          <a href={product.source.url} target="_blank" rel="noreferrer">{natural ? 'View USDA food' : 'View product'}</a>
        </div>
      </div>;
    })}
    <small>{mode === 'natural' ? <>Data: <a href="https://fdc.nal.usda.gov/download-datasets/" target="_blank" rel="noreferrer">USDA FoodData Central</a>, SR Legacy April 2018 / Foundation April 2026, CC0. This is a downloaded reference dataset, not a live USDA API request. Vitamin A is reported as RAE; salt is left unknown when not supplied.</> : <>Data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> / <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. Coverage and completeness vary.</>}</small>
  </div>;
}
