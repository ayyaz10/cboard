export const APP_THEMES = Object.freeze(['original', 'matrix', 'midnight']);

export function resolveStoredTheme(value) {
  return APP_THEMES.includes(value) ? value : 'original';
}
