import { NUTRIENTS } from "../nutrition/nutrients";
import { diaryTotals, itemNutrition } from "./diaryData";
const format = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
export function NutritionTotals({ meals, goals, compact = false }) {
  const totals = diaryTotals(meals);
  const primaryNutrients = NUTRIENTS.slice(0, 5);
  const missingDetails = meals.flatMap((meal) =>
    meal.items.flatMap((item) => {
      const nutrition = itemNutrition(item);
      const missing = primaryNutrients
        .filter(([key]) => nutrition[key] == null)
        .map(([, label]) => label);
      return missing.length ? [{ id: `${meal.id}:${item.id}`, name: item.name, missing }] : [];
    }),
  );
  function nutrient([key, label, unit]) {
    const total = totals[key];
    const target = goals?.[key];
    return (
      <div key={key} className="diary-nutrient">
        <span>{label}</span>
        <strong>
          {total.known ? format(total.value) : "—"} <small>{unit}</small>
        </strong>
        {!compact && total.missing > 0 && (
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
      <div className="diary-macros">{primaryNutrients.map(nutrient)}</div>
      {compact && missingDetails.length > 0 && (
        <details className="diary-partial-nutrition">
          <summary>
            Partial nutrition · {missingDetails.length} food{missingDetails.length === 1 ? "" : "s"}
          </summary>
          <ul>
            {missingDetails.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong>
                <span>{item.missing.join(", ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
