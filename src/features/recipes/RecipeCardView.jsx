import { createContext, useContext, useEffect, useRef, useState } from 'react';
import './recipeCardView.css';

const sizes = ['small', 'medium', 'large', 'details'];
const viewLabels = { small: 'Tiles', medium: 'Cards', large: 'Gallery', details: 'Details' };
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
    <label className="recipe-view-control">
      <span>View</span>
      <select aria-label="Recipe view" value={size} onChange={(event) => setSize(event.target.value)}>
        {sizes.map((value) => <option key={value} value={value}>{viewLabels[value]}</option>)}
      </select>
    </label>
  );
}

export function RecipeMasonryGrid({ as: Component = 'div', className = '', children }) {
  const grid = useRef(null);
  useEffect(() => {
    const element = grid.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const resize = () => {
      const styles = window.getComputedStyle(element);
      const row = Number.parseFloat(styles.gridAutoRows) || 8;
      const gap = Number.parseFloat(styles.rowGap) || 0;
      [...element.children].forEach((item) => {
        const height = item.getBoundingClientRect().height;
        const value = `span ${Math.ceil((height + gap) / (row + gap))}`;
        if (item.style.gridRowEnd !== value) item.style.gridRowEnd = value;
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    [...element.children].forEach((item) => observer.observe(item));
    resize();
    return () => observer.disconnect();
  }, [children]);
  return <Component ref={grid} className={`${className} recipe-card-masonry`}>{children}</Component>;
}

export function useRecipeCardGrid() {
  const { size } = useContext(CardViewContext);
  return {
    small: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
    medium: 'grid gap-5 md:grid-cols-2 xl:grid-cols-3',
    large: 'grid gap-6 lg:grid-cols-2',
    details: 'grid gap-3',
  }[size];
}
