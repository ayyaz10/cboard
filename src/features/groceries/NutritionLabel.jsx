import { useEffect, useRef, useState } from "react";
import { readRecipeImage } from "../recipes/recipeImage";
import { invokeNutritionFunction } from "../../services/nutritionLookup";
import { nutrients, validateNutrition } from "./groceryData";
export function NutritionLabel({ onSelect }) {
  const [photo, setPhoto] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const job = useRef(0);
  useEffect(() => () => { job.current++; }, []);
  async function upload(file) {
    if (!file) return;
    const id = ++job.current;
    setBusy(true); setError(""); setDraft(null); setPhoto(null);
    try {
      const image = await readRecipeImage(file);
      if (id !== job.current) return;
      setPhoto(image);
      const result = await invokeNutritionFunction("nutrition-label", { image });
      if (id === job.current) setDraft(result.nutrition);
    } catch (err) { if (id === job.current) setError(err.message); }
    finally { if (id === job.current) setBusy(false); }
  }
  const number = (value) => value === "" ? null : Number(value);
  return <div className="g-label-upload">
    <label>Upload a nutrition-label photo
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
        onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
    <p className="g-hint">Include the serving-size headings. JPG, PNG or WebP, up to 5 MB. The photo is sent to Gemini to read the label and is not saved with your groceries. Uses your daily AI reading allowance.</p>
    {photo && <img className="g-label-preview" src={photo} alt="Uploaded nutrition label for review" />}
    {busy && <p role="status">Reading the label...</p>}
    {error && <p role="alert">{error}</p>}
    {draft && <div>
      <strong>Review the label values</strong>
      <p>Check the numbers and column against the photo before using them. Blank means unreadable or missing.</p>
      <div className="g-nutrition-grid">
        <label>Per quantity<input type="number" min="0.0001" step="any" value={draft.quantity ?? ""} onChange={(e) => setDraft({ ...draft, quantity: number(e.target.value) })} /></label>
        <label>Unit<select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>{["g", "ml", "pieces"].map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        {nutrients.map(([key, label, unit]) => <label key={key}>{label} ({unit})<input type="number" min="0" step="any" value={draft[key] ?? ""} placeholder="Not readable" onChange={(e) => setDraft({ ...draft, [key]: number(e.target.value) })} /></label>)}
      </div>
      <button type="button" onClick={() => {
        try {
          validateNutrition(draft);
          onSelect({ ...draft, source: { provider: "Label photo", name: "Reviewed label photo", fetchedAt: new Date().toISOString() } });
          setDraft(null); setPhoto(null); setError("");
        } catch (err) { setError(err.message); }
      }}>Use reviewed values</button>
      <button type="button" onClick={() => { setDraft(null); setPhoto(null); }}>Discard</button>
    </div>}
  </div>;
}
