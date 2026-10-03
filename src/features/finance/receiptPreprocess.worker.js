import { processReceiptPixels } from './receiptImageProcessing.js';
self.onmessage = event => {
  try {
    const result=processReceiptPixels(event.data);
    self.postMessage(result,[result.cropped.data.buffer,...Object.values(result.variants).map(value=>value.buffer),...(result.aligned?[result.aligned.data.buffer]:[]),...(result.alignedContrast?[result.alignedContrast.data.buffer]:[])]);
  } catch { self.postMessage({error:'Preprocessing unavailable'}); }
};
