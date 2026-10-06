# CBoard themes and shared UI

Theme metadata lives in [`src/contexts/themeRegistry.js`](src/contexts/themeRegistry.js). The registry is the source for valid theme IDs, the Theme picker, the provider's cycle action, and browser `color-scheme` / `theme-color` metadata. Persisted preference remains in `localStorage` as `cboard-theme`.

Theme values live in [`src/styles/design-tokens.css`](src/styles/design-tokens.css). Add a registry entry and a matching `html[data-theme="id"]` block. New themes can inherit the Original values and override only the values they change: semantic color, chart, radius, elevation, control size, and typography variables. Keep values semantic (`--color-danger`, `--chart-primary`) rather than naming them after a particular app.

Shared primitives in `src/components/ui` use those variables. Prefer `Button` with a semantic variant, `Card` / `Panel`, `Badge`, `Tabs`, `FileUpload`, `FormField`, and the page/section heading patterns for new or migrated UI. Domain components own content and behavior; they should not inspect the current theme or select theme-specific hex values.

To add a theme:

1. Add `{ id, name, colorScheme, themeColor, preview }` to `THEME_REGISTRY` in `src/contexts/themeRegistry.js`.
2. Add `html[data-theme="your-id"]` token overrides in `src/styles/design-tokens.css`; omitted variables inherit the base set.
3. Check the theme selector and key screens: Finance, Food Diary, Recipes, Profile/Backup, Tracker, Grocery, Training, Notes, and a calculator. Check narrow/mobile layout and native date/file controls too.
4. Run `npm run build`, `npm run test:pwa`, and `npm run test:backup`.

## Migration status

The semantic foundation and reusable primitives are in place, and the Theme registry, toggle, notification palette, profile picture picker, Finance section tabs, base controls, and Tracker chart now consume shared definitions. Several older pages still have scoped CSS or inline utility classes with fixed colors, sizes, or geometry. Midnight currently retains its legacy compatibility rules in `src/styles/midnight.css` while those page styles are migrated. When migrating an old pattern, replace its fixed visual values with the semantic token or shared primitive and then remove the corresponding compatibility rule. Avoid adding another theme-specific page override.
