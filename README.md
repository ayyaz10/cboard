# Calculators

A simple, clean, responsive calculator built with React, Vite, and Tailwind CSS.

## Feature Log

- `2026-04-13` Added `Mass Unit Converter` with metric and imperial units plus the exact formula for each selected conversion.
- `2026-04-13` Added `Recent results` for each calculator, storing the last 5 successful saved calculations in the browser.
- `2026-04-13` Added `Remove saved result` action so any recent record can be deleted with the `x` button.
- `2026-04-13` Added `Most-used unit preselection` for the mass converter so the `From` and `To` units default to the units used most often.

## What it does

- Enter a total quantity
- Enter the total calories for that quantity
- Enter a desired quantity
- Get the calories for that desired quantity

Formula used:

- `calories per unit = total calories / total quantity`
- `result = calories per unit x desired quantity`

Future Calculators:
Converters
Trade return calculator
https://insider-week.com/en/trade-return-calculator/

## Run locally

```bash
npm install
npm run dev
```

To create a production build:

```bash
npm run build
```

## Project structure

```text
src/
  app/
    App.jsx
  components/
    layout/
    ui/
  features/
    calculators/
      calorie/
      registry.js
  styles/
```

## How to add more calculators later

1. Create a new feature folder inside `src/features/calculators/`
2. Add its UI component and calculation logic in that folder
3. Register it in `src/features/calculators/registry.js`
4. Reuse the shared UI components from `src/components/ui/`

This keeps calculator-specific logic isolated while sharing layout, form inputs, and result display patterns across the app.
