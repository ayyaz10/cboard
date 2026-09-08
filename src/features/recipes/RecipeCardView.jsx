import { createContext, useContext, useState } from 'react';
import './recipeCardView.css';

const sizes = ['small', 'medium', 'large'];
const storageKey = 'cboard-recipe-card-size';
const CardViewContext = createContext({ size: 'medium', setSize: () => {} });

export function RecipeCardViewProvider({ children }) {
  const [size, updateSize] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return sizes.includes(saved) ? saved : 'medium';
    } catch {
      return 'medium';
    }
  });
  function setSize(next) {
    if (!sizes.includes(next)) return;
    updateSize(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* Keep the selected view usable when storage is unavailable. */
    }
  }
  return (
    <CardViewContext.Provider value={{ size, setSize }}>
      <div className={`recipe-view-${size}`}>{children}</div>
    </CardViewContext.Provider>
  );
}

export function RecipeCardViewControl() {
  const { size, setSize } = useContext(CardViewContext);
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mb-2 text-sm font-bold text-black">Card size</legend>
      {sizes.map((value) => (
        <button
          type="button"
          key={value}
          aria-pressed={size === value}
          onClick={() => setSize(value)}
          className={`rounded-full border-2 border-black px-4 py-2 text-sm font-semibold capitalize text-black transition focus-visible:outline-offset-4 ${size === value ? 'bg-[#c5ff6f]' : 'bg-white'}`}
        >
          {value[0].toUpperCase() + value.slice(1)}
        </button>
      ))}
    </fieldset>
  );
}

export function useRecipeCardGrid() {
  const { size } = useContext(CardViewContext);
  return {
    small: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    medium: 'grid gap-5 md:grid-cols-2 xl:grid-cols-3',
    large: 'grid gap-6 lg:grid-cols-2',
  }[size];
}
