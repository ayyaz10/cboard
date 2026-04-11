# Calorie Calculator

A simple, clean, responsive calculator built with React, Vite, and Tailwind CSS.

## What it does

- Enter a total quantity
- Enter the total calories for that quantity
- Enter a desired quantity
- Get the calories for that desired quantity

Formula used:

- `calories per unit = total calories / total quantity`
- `result = calories per unit x desired quantity`

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
