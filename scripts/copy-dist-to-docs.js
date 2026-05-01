import {
  rmSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

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

rmSync(dest, { recursive: true, force: true });
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
      const knownRoutes = new Set(['', 'login', 'board', 'calculators', 'progress-tracker']);
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
