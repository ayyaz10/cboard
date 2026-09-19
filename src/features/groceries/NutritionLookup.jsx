import { useEffect, useRef, useState } from "react";
import { searchNutrition, lookupBarcode } from "../../services/nutritionLookup";
import { BarcodeScanner } from "./BarcodeScanner";
import { NutritionLabel } from "./NutritionLabel";
import { nutrients } from "./groceryData";

export function NutritionLookup({ name, active, visible, onSelect }) {
  const [mode, setMode] = useState("name");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState(name);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [basis, setBasis] = useState({});
  const request = useRef(0);
  const searched = useRef("");
  async function lookup(text, byBarcode = false) {
    const id = ++request.current;
    setBusy(true); setError(""); setResults(null); setBasis({});
    try {
      const rows = await (byBarcode ? lookupBarcode(text) : searchNutrition(text));
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
    if (active && mode === "name" && name.trim().length >= 2 && searched.current !== name) {
      searched.current = name;
      lookup(name);
    }
  }, [active, name, mode]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => { if (!visible) setScanning(false); }, [visible]);
  return <div className="g-nutrition-lookup">
    <div className="g-actions" aria-label="Nutrition lookup method">
      {[["name", "Product name"], ["barcode", "Scan barcode"], ["photo", "Label photo"]].map(([key, title]) =>
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
    {mode === "name" && <>

    <div className="g-tools">
      <label>Product name or brand
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
    <p className="g-hint">Choose the matching food and preparation (for example, dry or cooked rice). Values are for the product as sold.</p>
    </>}
    {busy && <p role="status">Looking up nutrition...</p>}
    {error && <p role="alert">{error}</p>}
    {results?.length === 0 && <p role="status">{mode === "barcode" ? "No nutrition record found for this barcode. Try a label photo or search by name." : 'No matching nutrition records found. Try a shorter name (for example, "cheddar") or add the brand.'}</p>}
    {results?.map((product) => {
      const unit = basis[product.code] || product.nutrition.unit;
      return <div className="g-nutrition-result" key={product.code}>
        <strong>{product.name}</strong>
        <p>{[product.brand, product.pack].filter(Boolean).join(" / ")}</p>
        <small>{nutrients.map(([key, label, suffix]) => `${label}: ${product.nutrition[key] == null ? "unknown" : `${product.nutrition[key]} ${suffix}`}`).join(" / ")}</small>
        <p>Per 100 {unit || "g or ml (choose below)"}</p>
        {<label>Nutrition basis (auto-selected; change if needed)
          <select value={unit || ""} onChange={(e) => setBasis({ ...basis, [product.code]: e.target.value })}>
            <option value="">Choose g or ml</option><option value="g">100 g</option><option value="ml">100 ml</option>
          </select>
        </label>}
        <div className="g-actions">
          <button type="button" disabled={!unit} onClick={() => {
            onSelect({ ...product.nutrition, unit, source: { ...product.source, name: [product.name, product.brand].filter(Boolean).join(' · '), fetchedAt: new Date().toISOString() } });
            setResults(null);
          }}>Use these values</button>
          <a href={product.source.url} target="_blank" rel="noreferrer">View product</a>
        </div>
      </div>;
    })}
    <small>Data: <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a> / <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. Coverage and completeness vary.</small>
  </div>;
}
