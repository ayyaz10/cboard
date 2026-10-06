import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { resolveStoredTheme } from './themePreferences.js';

const ThemeContext = createContext(null);
const THEME_STORAGE_KEY = 'cboard-theme';
function getStoredTheme() {
  if (typeof window === 'undefined') {
    return 'original';
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
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === 'midnight' ? '#080a0c' : theme === 'matrix' ? '#000000' : '#f4f0e6';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value = useMemo(() => ({
    theme,
    setTheme,
    isMatrixTheme: theme === 'matrix',
    isMidnightTheme: theme === 'midnight',
    toggleTheme: () => {
      setTheme(currentTheme => currentTheme === 'original' ? 'matrix' : currentTheme === 'matrix' ? 'midnight' : 'original');
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
