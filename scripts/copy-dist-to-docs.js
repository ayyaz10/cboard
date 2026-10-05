import {
  rmSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const src = "dist";
const dest = "docs";

function copyRecursive(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const sourcePath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(sourcePath, destPath);
    } else {
      copyFileSync(sourcePath, destPath);
    }
  }
}

// Remove only old generated bundles, preserving project documentation in docs/.
const assetsDir = resolve(dest, 'assets');
if (!assetsDir.startsWith(resolve(dest) + sep)) throw new Error('Invalid assets directory');
mkdirSync(assetsDir, { recursive: true });
for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|css|png|svg|woff2?)$/.test(entry.name)) {
    const target = resolve(assetsDir, entry.name);
    if (!target.startsWith(assetsDir + sep)) throw new Error('Invalid asset path');
    rmSync(target);
  }
}
copyRecursive(src, dest);
writeFileSync(
  join(dest, "404.html"),
  `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>C Board</title>
  </head>
  <body>
    <script>
      const knownRoutes = new Set(['', 'login', 'board', 'calculators', 'progress-tracker', 'notes', 'groceries', 'weight-progress', 'finance', 'account', 'training', 'food-diary', 'recipes', 'focus-timer']);
      const parts = location.pathname.split('/').filter(Boolean);
      const base = knownRoutes.has(parts[0] || '') ? '/' : '/' + parts[0] + '/';
      const routePath = '/' + parts.slice(base === '/' ? 0 : 1).join('/');
      sessionStorage.setItem('spa:redirect', routePath + location.search);
      location.replace(base);
    </script>
  </body>
</html>
`,
);
console.log("Copied dist to docs/");
