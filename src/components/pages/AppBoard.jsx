import { getAppHref } from '../../app/useRoute';
import { PageShell } from '../layout/PageShell';
import { AppNavigation } from '../layout/AppNavigation';

const appSections = [
  {
    id: 'finance', path: '/finance', label: 'Money workspace', name: 'Finance',
    description: 'Plan your month, track spending, manage repayments, and grow savings goals.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Budget & goals',
  },
  {
    id: 'food-diary', path: '/food-diary', label: 'Meals & nutrition', name: 'Food Diary',
    description: 'Log meals, review nutrition, and keep your daily food records together.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Daily food log',
  },
  {
    id: 'weight-progress', path: '/weight-progress', label: 'Your personal progress', name: 'Weight Progress',
    description: 'Log weigh-ins, follow your weight trend, and compare private progress photos.',
    color: '#ff90e8', colorKey: 'pink', countLabel: 'Weight & photos',
  },
  {
    id: 'habit-improvement', path: '/habit-improvement', label: 'Understand patterns', name: 'Habit Improvement',
    description: 'Track recurring patterns, understand why they happen, and plan what to change next time.',
    color: '#ffd166', colorKey: 'amber', countLabel: 'Improvement tracker',
  },
  {
    id: 'groceries', path: '/groceries', label: 'Your kitchen', name: 'Groceries',
    description: 'Track what is left, restock in a tap, and take your shopping list with you.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Stock & shopping list',
  },
  {
    id: 'notebook', path: '/notes', label: 'Your notebook', name: 'Notes',
    description: 'Write rich notebook pages, attach media, and link notes to trackers.',
    color: '#ff90e8', colorKey: 'pink', countLabel: 'Rich notebook',
  },
  {
    id: 'calculator-board', path: '/calculators', label: 'Quick tools', name: 'Calculator Tools',
    description: 'Percentage, calories, and unit tools collected in one quick board.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Calculator tools',
  },
  {
    id: 'training', path: '/training', label: 'Strength, skill & recovery', name: 'Training',
    description: 'Start your session, log a set in one tap, and build consistent progress.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Calisthenics tracker',
  },
  {
    id: 'recipes', path: '/recipes', label: 'Meal library', name: 'Recipes',
    description: 'Keep your meal plans, ingredients, alternatives, and recipe photos together.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Import your recipes',
  },
  {
    id: 'progress-tracker', path: '/progress-tracker', label: 'Goals & metrics', name: 'Progress Tracker',
    description: 'Create goals, log daily metrics, and watch your numbers move over time.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Goal dashboard',
  },
  {
    id: 'focus-timer', path: '/focus-timer', label: 'Focus sessions', name: 'Focus Timer',
    description: 'Run focus sessions, breaks, reflections, and review saved history.',
    color: '#ffd166', colorKey: 'amber', countLabel: 'Focus sessions',
  },
  {
    id: 'profile', path: '/account', label: 'Your account', name: 'Profile',
    description: 'Manage your profile details and sign-in security.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Profile & security',
  },
];

export function AppBoard({ calculators }) {
  return (
    <PageShell>
      <section className="panel p-6 sm:p-8 lg:p-10">
        <AppNavigation activePath="/board" />
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <span className="pill">Control board</span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            {appSections.length} app sections
          </span>
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-[-0.05em] text-black sm:text-5xl lg:text-6xl">
          C Board
        </h1>

        <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-black/70 sm:text-lg">
          Pick a workspace from the control board.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {appSections.map((section) => (
            <a
              key={section.id}
              href={getAppHref(section.path)}
              className="board-card theme-color-card"
              data-theme-color={section.colorKey}
              style={{ '--theme-card-bg': section.color }}
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
                  {section.label}
                </p>
                <h2 className="mt-3 text-2xl font-bold tracking-[-0.04em] text-black sm:text-3xl">
                  {section.name}
                </h2>
              </div>

              <p className="mt-4 max-w-sm text-sm font-medium leading-7 text-black/72">
                {section.description}
              </p>

              <div className="mt-8 flex items-center justify-between gap-3">
                <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
                  {section.id === 'calculator-board'
                    ? `${calculators.length} calculators`
                    : section.countLabel}
                </span>
                <span className="text-2xl font-bold text-black" aria-hidden="true">{'->'}</span>
              </div>
            </a>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
