import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <label className="theme-toggle inline-flex items-center gap-2">
      <span className="theme-toggle-label">
        Theme
      </span>
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        className="theme-select ui-control"
        aria-label="Select app theme"
      >
        {themes.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}
