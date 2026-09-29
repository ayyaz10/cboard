import { useMemo } from "react";
import { nutrientContributions } from "./diaryData";

const NUTRIENTS = [
  ["calories", "Calories", "Energy from your food", "#a34e3c", "kcal"],
  ["protein", "Protein", "Build & repair", "#347c4b", "g"],
  ["carbs", "Carbs", "Energy", "#bd7b16", "g"],
  ["fat", "Fat", "Energy & hormones", "#99623e", "g"],
  ["fiber", "Fibre", "Digestion & fullness", "#536fa8", "g"],
];

const format = (value) => new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
}).format(value);

const dateLabel = (date, today) => date === today
  ? "today"
  : new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));

export function DiaryFoodSources({ meals, goals, date, today }) {
  const contributions = useMemo(() => nutrientContributions(meals), [meals]);
  const foodCount = meals.reduce((count, meal) => count + meal.items.length, 0);

  return (
    <section className="diary-sources" aria-labelledby="food-sources-heading">
      <div className="diary-sources-intro">
        <div>
          <span className="pill">Calories &amp; macro breakdown</span>
          <h2 id="food-sources-heading">What your food is giving you</h2>
          <p>
            Each percentage is that food&apos;s share of the nutrient you logged for {dateLabel(date, today)}.
            The same food can appear in more than one group.
          </p>
        </div>
        <span className="diary-source-count">{foodCount} food {foodCount === 1 ? "entry" : "entries"}</span>
      </div>

      {!foodCount ? (
        <div className="diary-panel diary-sources-empty">
          <strong>No foods logged for this day yet.</strong>
          <p>Open the Day log tab and add a meal to see where your calories, macros and fibre come from.</p>
        </div>
      ) : (
        <div className="diary-source-grid">
          {NUTRIENTS.map(([key, label, description, color, unit]) => {
            const nutrient = contributions[key];
            const target = goals?.[key];
            const targetPercent = target > 0 ? (nutrient.total / target) * 100 : null;
            return (
              <article className="diary-source-card" key={key} style={{ "--source-color": color }}>
                <header>
                  <div>
                    <span>{description}</span>
                    <h3>{label}</h3>
                  </div>
                  <div className="diary-source-total">
                    <strong>{format(nutrient.total)} {unit}</strong>
                    {target > 0 && <small>{format(targetPercent)}% of {format(target)} {unit} target</small>}
                  </div>
                </header>

                {nutrient.foods.length ? (
                  <ol className="diary-source-list">
                    {nutrient.foods.map((food) => (
                      <li key={food.name.toLocaleLowerCase()}>
                        <div className="diary-source-row">
                          <strong>{food.name}</strong>
                          <span><b>{format(food.value)} {unit}</b> · {format(food.percentage)}%</span>
                        </div>
                        <div className="diary-source-track" aria-hidden="true">
                          <span style={{ width: `${food.percentage}%` }} />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="diary-source-none">No recorded {label.toLocaleLowerCase()} from this day&apos;s foods.</p>
                )}
                {nutrient.missing > 0 && (
                  <p className="diary-source-warning">
                    {nutrient.missing} food {nutrient.missing === 1 ? "is" : "items are"} missing {label.toLocaleLowerCase()} data, so this breakdown is partial.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
