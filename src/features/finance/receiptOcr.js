import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { scoreReceiptCandidate } from './receiptLayout.js';
import { parseReceipt } from './receiptParser.js';
export { validateOcrImage as validateReceiptImage, prepareOcrImage as prepareReceiptImage } from '../../services/ocr/imageOcr.js';

export function createReceiptOcrSession(onProgress) {
  return createImageOcrSession({
    layout: 'receipt', parse: parseReceipt, score: scoreReceiptCandidate,
    shouldStop(results) {
      const latest=results.at(-1), {parsed,confidence}=latest;
      const corroborated=results.slice(0,-1).some(other=>other.parsed.total===parsed.total&&other.parsed.date===parsed.date&&other.parsed.merchantName===parsed.merchantName);
      return latest.complete&&(!parsed.itemCount||latest.countMatches)&&((parsed.items.every(item=>item.confidence.name>=75&&item.confidence.lineTotal>=75)&&confidence>=80)||(corroborated&&confidence>=70));
    },
    finalize(best,results) {
      for(const item of best.parsed.items) {
        const other=results.slice(1).flatMap(result=>result.parsed.items).filter(candidate=>item.retailerProductCode?candidate.retailerProductCode===item.retailerProductCode:candidate.normalizedName===item.normalizedName);
        if(other.some(candidate=>candidate.lineTotal!==item.lineTotal))item.confidence.lineTotal=Math.min(55,item.confidence.lineTotal);
      }
    },
  },onProgress);
}
