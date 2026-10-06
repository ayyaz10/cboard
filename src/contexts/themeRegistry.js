/** Theme metadata is the single source used by persistence, the provider and the picker. */
export const THEME_REGISTRY = Object.freeze([
  { id: 'original', name: 'Original', colorScheme: 'light', themeColor: '#f4f0e6', preview: ['#f4f0e6', '#c5ff6f'] },
  { id: 'matrix', name: 'Matrix', colorScheme: 'dark', themeColor: '#000000', preview: ['#000000', '#00ff41'] },
  { id: 'midnight', name: 'Midnight', colorScheme: 'dark', themeColor: '#080a0c', preview: ['#080a0c', '#f28a47'] },
]);

export const THEME_IDS = Object.freeze(THEME_REGISTRY.map(({ id }) => id));
export const DEFAULT_THEME_ID = THEME_REGISTRY[0].id;
export const getTheme = (id) => THEME_REGISTRY.find((theme) => theme.id === id) || THEME_REGISTRY[0];
