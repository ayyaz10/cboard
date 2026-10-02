import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('base64');
export function buildPwa(outDir, base) {
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('PWA requires an absolute, trailing-slash Vite base.');
  const manifest = {
    id: base, name: 'CBoard', short_name: 'CBoard', description: 'Your personal control board.',
    start_url: base, scope: base, display: 'standalone',
    theme_color: '#f4f0e6', background_color: '#f4f0e6',
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(resolve(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
  function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
  }
  const assets = files(outDir).map(path => ({ path, name: relative(outDir, path).replaceAll('\\', '/') }))
    .filter(({ name }) => /^(assets\/.*\.(js|css|png|svg|woff2?)|ocr\/[^/]+\.(js|gz)|icons\/.*\.png|index\.html|manifest\.webmanifest|nutrition\/usda-foods\.json|recipes\/[^/]+\.json)$/.test(name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ path, name }) => ({ url: base + name, integrity: `sha256-${digest(readFileSync(path))}`, optional: /^(nutrition|recipes|ocr)\//.test(name) }));
  const source = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8');
  const version = createHash('sha256').update(JSON.stringify(assets) + source).digest('hex').slice(0, 20);
  const config = { base, version, assets };
  writeFileSync(resolve(outDir, 'sw.js'), source.replace('/* PWA_BUILD_CONFIG */', `const CONFIG = ${JSON.stringify(config)};`));
  return config;
}

export function pwaPlugin() {
  let config;
  return {
    name: 'cboard-pwa', enforce: 'post',
    configResolved(value) { config = value; },
    transformIndexHtml(html) {
      return config.command === 'serve' ? html.replace(/\s*<link rel="manifest"[^>]*>/, '') : html;
    },
    closeBundle() { if (config.command === 'build') buildPwa(resolve(config.root, config.build.outDir), config.base); },
  };
}
