import { DEFAULT_THEME_ID, THEME_IDS } from './themeRegistry.js';

export const APP_THEMES = THEME_IDS;

export function resolveStoredTheme(value) {
  return APP_THEMES.includes(value) ? value : DEFAULT_THEME_ID;
}
