import { getAppHref } from '../../app/useRoute';

const primaryNavItems = [
  { path: '/board', label: 'C Board' },
  { path: '/calculators', label: 'Calculator Tools' },
  { path: '/progress-tracker', label: 'Progress Tracker' },
  { path: '/notes', label: 'Notes' },
  { path: '/recipes', label: 'Recipes' },
  { path: '/groceries', label: 'Groceries' },
  { path: '/focus-timer', label: 'Focus Timer' },
  { path: '/finance', label: 'Finance' },
];

export function AppNavigation({ activePath, extraItems = [] }) {
  return (
    <nav className="overflow-x-auto">
      <div className="flex min-w-max gap-2">
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
  );
}
