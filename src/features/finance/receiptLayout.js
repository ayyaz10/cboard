export { reconstructOcrLines as reconstructReceiptLines } from '../../services/ocr/ocrLayout.js';

export function scoreReceiptCandidate(receipt, confidence = 0) {
  const sum = receipt.items.reduce((sum, item) => sum + (item.lineTotal || 0), 0);
  const units = receipt.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const complete = receipt.total != null && receipt.items.length > 0 && Math.abs(sum - receipt.total) <= 1;
  const countMatches = receipt.itemCount != null && (receipt.itemCount === units || receipt.itemCount === receipt.items.length);
  // Structural evidence dominates the OCR engine's sometimes misleading confidence.
  let score = Math.min(30, receipt.items.length * 3) + Math.max(0, confidence) / 10;
  if (receipt.merchantName) score += 5;
  if (receipt.date) score += 5;
  if (receipt.total != null) score += 12;
  if (complete) score += 24;
  if (countMatches) score += 12;
  if (receipt.totalConfirmed) score += 8;
  score -= receipt.items.filter(item => item.confidence?.name < 55 || !/[aeiouy]/i.test(item.name)).length * 3;
  if (receipt.itemCount != null && !countMatches) score -= Math.min(15, Math.abs(receipt.itemCount - units) * 3);
  return { score, complete, countMatches };
}
