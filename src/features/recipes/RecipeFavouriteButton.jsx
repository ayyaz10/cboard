import './recipeFavourites.css';

export function RecipeFavouriteButton({ recipe, favourite, pending, onToggle }) {
  if (!onToggle) return null;
  const label = `${favourite ? 'Remove' : 'Add'} ${recipe.title} ${favourite ? 'from' : 'to'} favourites`;
  return (
    <button type="button" className="recipe-favourite" aria-label={label} title={label}
      aria-pressed={favourite} aria-busy={pending || undefined} disabled={pending}
      onClick={() => onToggle(recipe)}>
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"
        fill={favourite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
      </svg>
    </button>
  );
}
