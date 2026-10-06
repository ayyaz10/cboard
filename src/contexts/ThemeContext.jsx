import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { resolveStoredTheme } from './themePreferences.js';
import { DEFAULT_THEME_ID, getTheme, THEME_REGISTRY } from './themeRegistry.js';

const ThemeContext = createContext(null);
const THEME_STORAGE_KEY = 'cboard-theme';
function getStoredTheme() {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_ID;
  }

  return resolveStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function applyTheme(theme) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('theme-matrix', theme === 'matrix');
  document.documentElement.classList.toggle('theme-midnight', theme === 'midnight');
  const definition = getTheme(theme);
  document.documentElement.style.colorScheme = definition.colorScheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = definition.themeColor;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const handlePreviewTheme = (event) => setTheme(event.detail);
    window.addEventListener('cboard-theme-preview', handlePreviewTheme);
    return () => window.removeEventListener('cboard-theme-preview', handlePreviewTheme);
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme,
    themes: THEME_REGISTRY,
    isMatrixTheme: theme === 'matrix',
    isMidnightTheme: theme === 'midnight',
    toggleTheme: () => {
      setTheme(currentTheme => {
        const index = THEME_REGISTRY.findIndex(({ id }) => id === currentTheme);
        return THEME_REGISTRY[(index + 1) % THEME_REGISTRY.length].id;
      });
    },
  }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return context;
}
