// Preserve geometry until parsing; sparse OCR often returns prices as separate lines.
export function reconstructReceiptLines(data) {
  const words = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])))
    .filter(word => word.text?.trim() && word.bbox && word.bbox.y1 > word.bbox.y0)
    .map(({ text, confidence, bbox }) => ({ text: text.trim(), confidence, bbox: { ...bbox } }));
  if (!words.length) return String(data.text || '').split(/\r?\n/).filter(line => line.trim()).map(text => ({ text, words: [], confidence: null, bbox: null }));
  const heights = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const rows = [];
  for (const word of words.sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2 || a.bbox.x0 - b.bbox.x0)) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.filter(row => Math.abs(row.cy - cy) < height * .55).sort((a, b) => Math.abs(a.cy - cy) - Math.abs(b.cy - cy))[0];
    if (row) { row.words.push(word); row.cy = row.words.reduce((sum, item) => sum + (item.bbox.y0 + item.bbox.y1) / 2, 0) / row.words.length; }
    else rows.push({ cy, words: [word] });
  }
  return rows.sort((a, b) => a.cy - b.cy).map(row => {
    const sorted = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return { text: sorted.map(word => word.text).join(' '), words: sorted,
      confidence: sorted.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / sorted.length,
      bbox: { x0: Math.min(...sorted.map(word => word.bbox.x0)), y0: Math.min(...sorted.map(word => word.bbox.y0)), x1: Math.max(...sorted.map(word => word.bbox.x1)), y1: Math.max(...sorted.map(word => word.bbox.y1)) } };
  });
}

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
