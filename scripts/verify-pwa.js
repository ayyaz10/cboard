import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const output = resolve(process.argv[2] || 'dist');
const read = path => process.argv.includes('--staged') ? execFileSync('git', ['show', ':' + relative(process.cwd(),path).replaceAll('\\','/')], { maxBuffer: 16 * 1024 * 1024 }) : readFileSync(path);
const manifest = JSON.parse(read(resolve(output, 'manifest.webmanifest')));
assert.equal(manifest.name, 'CBoard');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, manifest.scope);
assert.equal(manifest.id, manifest.scope);
const html = read(resolve(output, 'index.html')).toString('utf8');
assert.ok(html.includes(`${manifest.scope}manifest.webmanifest`));
assert.ok(html.includes('viewport-fit=cover'));
for (const icon of manifest.icons) {
  const png = read(resolve(output, icon.src.slice(manifest.scope.length)));
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
}
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
const sw = read(resolve(output, 'sw.js')).toString('utf8');
const config = JSON.parse(sw.match(/^const CONFIG = (.*);/)[1]);
assert.equal(config.base, manifest.scope);
for (const asset of config.assets) {
  assert.ok(asset.url.startsWith(manifest.scope));
  const bytes = read(resolve(output, asset.url.slice(manifest.scope.length)));
  assert.equal(asset.integrity, 'sha256-' + createHash('sha256').update(bytes).digest('base64'), asset.url);
}
assert.ok(!sw.includes('PWA_BUILD_CONFIG'));
console.log(`PWA verified: ${config.assets.length} public assets, valid icons, manifest, scope and integrity hashes. Build ${config.version}`);
