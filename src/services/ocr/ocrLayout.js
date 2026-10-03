// Preserve geometry until parsing; sparse OCR often returns prices as separate lines.
export function reconstructOcrLines(data) {
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

