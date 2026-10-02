export function validateReceiptImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WEBP receipt image.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose a receipt image smaller than 15 MB.');
}

export async function prepareReceiptImage(file, rotation = 0) {
  validateReceiptImage(file);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This image could not be opened. It may be damaged or in an unsupported format.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 60000000) throw new Error('This image is too large to scan safely. Crop or resize it first.');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height), Math.sqrt(4000000 / (bitmap.width * bitmap.height)));
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = rotation % 180 ? height : width;
    canvas.height = rotation % 180 ? width : height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(rotation * Math.PI / 180);
    context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    // Keep colour/contrast intact: heavy thresholding destroys faint thermal ink.
    return canvas;
  } finally { bitmap.close(); }
}

export function createReceiptOcrSession(onProgress) {
  let pending, worker, abort, disposed = false, active = false;
  async function getWorker() {
    if (!pending) pending = (async () => {
      const { createWorker } = await import('tesseract.js');
      if (disposed) throw new Error('Scan cancelled.');
      const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href;
      const created = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.slice(0, -1),
        logger: message => { if (!disposed) onProgress(message); }, errorHandler: () => {},
      });
      if (disposed) { await created.terminate(); throw new Error('Scan cancelled.'); }
      worker = created;
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return worker;
    })();
    return pending;
  }
  return {
    async scan(file, rotation) {
      if (active || disposed) throw new Error('Please finish the current scan first.');
      active = true;
      let canvas;
      try {
        canvas = await prepareReceiptImage(file, rotation);
        if (disposed) throw new Error('Scan cancelled.');
        const cancelled = new Promise((_, reject) => { abort = () => reject(new Error('Scan cancelled.')); });
        const recognition = (async () => {
          const engine = await getWorker();
          if (disposed) throw new Error('Scan cancelled.');
          return (await engine.recognize(canvas)).data;
        })();
        return await Promise.race([recognition, cancelled]);
      } finally { active = false; abort = null; if (canvas) { canvas.width = 0; canvas.height = 0; } }
    },
    dispose() {
      disposed = true;
      abort?.();
      if (worker) { void worker.terminate(); worker = null; }
      // Initialization cannot be interrupted by Tesseract's public API; getWorker
      // terminates immediately on completion if this session has been disposed.
      pending?.catch(() => {});
    },
  };
}
