export const APP_MODULES = [
  {
    id: 'finance', path: '/finance', label: 'Finance', name: 'Finance',
    description: 'Plan your month, track spending, manage repayments, and grow savings goals.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Budget & goals', order: 10,
  },
  {
    id: 'food-diary', path: '/food-diary', label: 'Food Diary', name: 'Food Diary',
    description: 'Log meals, review nutrition, and keep your daily food records together.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Daily food log', order: 20,
  },
  {
    id: 'weight-progress', path: '/weight-progress', label: 'Weight', name: 'Weight Progress',
    description: 'Log weigh-ins, follow your weight trend, and compare private progress photos.',
    color: '#ff90e8', colorKey: 'pink', countLabel: 'Weight & photos', order: 30,
  },
  {
    id: 'habit-improvement', path: '/habit-improvement', label: 'Habit Improvement', name: 'Habit Improvement',
    description: 'Track recurring patterns, understand why they happen, and plan what to change next time.',
    color: '#ffd166', colorKey: 'amber', countLabel: 'Improvement tracker', order: 40,
  },
  {
    id: 'groceries', path: '/groceries', label: 'Groceries', name: 'Groceries',
    description: 'Track what is left, restock in a tap, and take your shopping list with you.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Stock & shopping list', order: 50,
  },
  {
    id: 'notebook', path: '/notes', label: 'Notes', name: 'Notes',
    description: 'Write rich notebook pages, attach media, and link notes to trackers.',
    color: '#ff90e8', colorKey: 'pink', countLabel: 'Rich notebook', order: 60,
  },
  {
    id: 'calculator-board', path: '/calculators', label: 'Calculator Tools', name: 'Calculator Tools',
    description: 'Percentage, calories, and unit tools collected in one quick board.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Calculator tools', order: 70,
  },
  {
    id: 'training', path: '/training', label: 'Training', name: 'Training',
    description: 'Start your session, log a set in one tap, and build consistent progress.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Calisthenics tracker', order: 80,
  },
  {
    id: 'recipes', path: '/recipes', label: 'Recipes', name: 'Recipes',
    description: 'Keep your meal plans, ingredients, alternatives, and recipe photos together.',
    color: '#c5ff6f', colorKey: 'lime', countLabel: 'Import your recipes', order: 90,
  },
  {
    id: 'progress-tracker', path: '/progress-tracker', label: 'Progress Tracker', name: 'Progress Tracker',
    description: 'Create goals, log daily metrics, and watch your numbers move over time.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Goal dashboard', order: 100,
  },
  {
    id: 'focus-timer', path: '/focus-timer', label: 'Focus Timer', name: 'Focus Timer',
    description: 'Run focus sessions, breaks, reflections, and review saved history.',
    color: '#ffd166', colorKey: 'amber', countLabel: 'Focus sessions', order: 110,
  },
  {
    id: 'profile', path: '/account', label: 'Profile', name: 'Profile',
    description: 'Manage your profile details and sign-in security.',
    color: '#9fe3ff', colorKey: 'cyan', countLabel: 'Profile & security', order: 120,
    navigation: false,
  },
];

export const primaryNavItems = APP_MODULES
  .filter(module => module.navigation !== false)
  .map(({ path, label }) => ({ path, label }));

export const dashboardModules = [...APP_MODULES].sort((a, b) => a.order - b.order);
