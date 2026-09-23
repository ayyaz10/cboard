import { getAppHref } from '../../app/useRoute';

const primaryNavItems = [
  { path: '/training', label: 'Training' },
  { path: '/board', label: 'C Board' },
  { path: '/calculators', label: 'Calculator Tools' },
  { path: '/progress-tracker', label: 'Progress Tracker' },
  { path: '/notes', label: 'Notes' },
  { path: '/recipes', label: 'Recipes' },
  { path: '/groceries', label: 'Groceries' },
  { path: '/focus-timer', label: 'Focus Timer' },
  { path: '/weight-progress', label: 'Weight Progress' },
  { path: '/finance', label: 'Finance' },
];

const relatedCalculators = {
  '/training': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
  ],
  '/recipes': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
    { path: '/calculators/calorie', label: 'Calorie portions' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/groceries': [
    { path: '/calculators/calorie', label: 'Calorie portions' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/weight-progress': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/progress-tracker': [
    { path: '/calculators/percentage', label: 'Percentage calculator' },
  ],
  '/finance': [
    { path: '/calculators/position-size', label: 'Position size' },
    { path: '/calculators/crypto-futures', label: 'Futures trade' },
    { path: '/calculators/percentage', label: 'Percentage calculator' },
  ],
};

export function AppNavigation({ activePath, extraItems = [] }) {
  const contextualItems = relatedCalculators[activePath] || [];
  return (
    <div className="space-y-2">
    <nav className="overflow-x-auto" aria-label="Main navigation">
      <div className="flex min-w-max gap-2 pb-1">
        {[...primaryNavItems, ...extraItems].map((item) => {
          const isActive = activePath === item.path;

          return (
            <a
              key={item.path}
              href={getAppHref(item.path)}
              className={`inline-flex items-center rounded-full border border-black/85 px-3.5 py-1.5 text-sm font-semibold tracking-[-0.02em] text-black transition ${
                isActive
                  ? 'bg-[#c5ff6f]'
                  : 'bg-[#fffdf8] hover:bg-white'
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
    {contextualItems.length > 0 && <nav className="flex flex-wrap items-center gap-2" aria-label="Related calculators">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-black/55">Related calculators</span>
      {contextualItems.map((item) => <a key={item.path} href={getAppHref(item.path)} className="inline-flex items-center rounded-full border border-black/70 bg-[#f4f9e9] px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-[#c5ff6f]">{item.label}</a>)}
    </nav>}
    </div>
  );
}
