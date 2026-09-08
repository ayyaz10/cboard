export function RecipeSource({ source, compact = false, linkClassName }) {
  if (!source || (compact && !source.showOnRecipeCard)) return null;
  const link = (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${linkClassName} max-w-full break-words`}
    >
      {source.label}
      <span aria-hidden="true" className="ml-2">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  if (compact) return link;
  return (
    <section
      className="space-y-3 rounded-2xl border-2 border-black bg-white p-5"
      aria-label="Recipe source"
    >
      <h2 className="text-xl font-bold">Recipe source</h2>
      <p className="break-all text-sm text-black/70">
        {new URL(source.url).hostname}
      </p>
      {link}
    </section>
  );
}
