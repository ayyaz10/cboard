import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Serve the worker, WASM and English model from CBoard, never a third-party CDN.
export function receiptOcrAssets() {
  let files, base;
  return {
    name: 'cboard-receipt-ocr-assets',
    configResolved(config) {
      base = config.base;
      const root = resolve(config.root, 'node_modules');
      files = new Map([
        ['worker.min.js', resolve(root, 'tesseract.js/dist/worker.min.js')],
        ['eng.traineddata.gz', resolve(root, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')],
        ['LICENSE-tesseract.txt', resolve(root, 'tesseract.js/LICENSE.md')],
        ...readdirSync(resolve(root, 'tesseract.js-core')).filter(name => name.endsWith('.wasm.js')).map(name => [name, resolve(root, 'tesseract.js-core', name)]),
      ]);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.replace(`${base}ocr/`, '');
        if (!req.url?.startsWith(`${base}ocr/`) || !files.has(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(files.get(name)));
      });
    },
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(path) });
    },
  };
}
