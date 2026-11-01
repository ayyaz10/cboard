import { useTheme } from '../../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <label className="theme-toggle" title={`Current theme: ${themes.find(item => item.id === theme)?.name || theme}`}>
      <span className="theme-toggle-icon" aria-hidden="true">◐</span>
      <select
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        className="theme-select ui-control"
        aria-label="Select app theme"
        title="Change theme"
      >
        {themes.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}
