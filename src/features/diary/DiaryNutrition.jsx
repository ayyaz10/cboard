import { NUTRIENTS } from "../nutrition/nutrients";
import { diaryTotals } from "./diaryData";
const format = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
export function NutritionTotals({ meals, goals, compact = false }) {
  const totals = diaryTotals(meals);
  function nutrient([key, label, unit]) {
    const total = totals[key];
    const target = goals?.[key];
    return (
      <div key={key} className="diary-nutrient">
        <span>{label}</span>
        <strong>
          {total.known ? format(total.value) : "—"} <small>{unit}</small>
        </strong>
        {total.missing > 0 && (
          <small>
            {total.known ? "Known subtotal" : "Unknown"} · {total.missing} food
            {total.missing === 1 ? "" : "s"} missing
          </small>
        )}
        {!compact && target > 0 && (
          <>
            <progress
              aria-label={`${label} towards daily target${total.missing ? ", partial data" : ""}`}
              max={target}
              value={Math.min(target, total.value)}
            />
            <small>
              Target {format(target)} {unit}
              {!total.missing && total.known > 0
                ? ` · ${format(Math.abs(target - total.value))} ${unit} ${total.value > target ? "over" : "remaining"}`
                : ""}
            </small>
          </>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="diary-macros">{NUTRIENTS.slice(0, 5).map(nutrient)}</div>
      {!compact && (
        <details className="diary-micros">
          <summary>More nutrients · vitamins & minerals</summary>
          <p>
            Only values supplied by your saved recipe, food record or label are
            included. Missing nutrients are not zero.
          </p>
          <div className="diary-macros">{NUTRIENTS.slice(5).map(nutrient)}</div>
        </details>
      )}
    </>
  );
}
