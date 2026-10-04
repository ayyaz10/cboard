// Preserve geometry until parsing; sparse OCR often returns prices as separate lines.
export function reconstructOcrLines(data, { preserveNumericPunctuation = false } = {}) {
  const words = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || [])))
    .filter(word => word.text?.trim() && word.bbox && word.bbox.y1 > word.bbox.y0)
    .map(({ text, confidence, bbox }) => ({ text: text.trim(), confidence, bbox: { ...bbox } }));
  if (!words.length) return String(data.text || '').split(/\r?\n/).filter(line => line.trim()).map(text => ({ text, words: [], confidence: null, bbox: null }));
  const punctuation = preserveNumericPunctuation ? words.filter(word => /^[.,]$/.test(word.text)) : [];
  const anchors = words.filter(word => !punctuation.includes(word));
  const heights = anchors.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const rows = [];
  for (const word of anchors.sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2 || a.bbox.x0 - b.bbox.x0)) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.filter(row => Math.abs(row.cy - cy) < height * .55).sort((a, b) => Math.abs(a.cy - cy) - Math.abs(b.cy - cy))[0];
    if (row) { row.words.push(word); row.cy = row.words.reduce((sum, item) => sum + (item.bbox.y0 + item.bbox.y1) / 2, 0) / row.words.length; }
    else rows.push({ cy, words: [word] });
  }
  // A decimal dot sits on the baseline, below the centre of the digits. Attach
  // it after clustering full-height words, only between nearby numeric tokens.
  for (const dot of punctuation) {
    const row = rows.find(row => {
      const left = row.words.filter(word => /[\dOIlS]$/.test(word.text) && word.bbox.x1 <= dot.bbox.x0).sort((a,b) => b.bbox.x1-a.bbox.x1)[0];
      const right = row.words.filter(word => /^[\dOIlS]/.test(word.text) && word.bbox.x0 >= dot.bbox.x1).sort((a,b) => a.bbox.x0-b.bbox.x0)[0];
      if (!left || !right) return false;
      const h = Math.min(left.bbox.y1-left.bbox.y0, right.bbox.y1-right.bbox.y0);
      return dot.bbox.x0-left.bbox.x1 <= h*.8 && right.bbox.x0-dot.bbox.x1 <= h*.8 && dot.bbox.y0 >= Math.min(left.bbox.y0,right.bbox.y0)-h*.15 && dot.bbox.y1 <= Math.max(left.bbox.y1,right.bbox.y1)+h*.2;
    });
    if (row) row.words.push(dot);
    else rows.push({cy:(dot.bbox.y0+dot.bbox.y1)/2, words:[dot]});
  }
  return rows.sort((a, b) => a.cy - b.cy).map(row => {
    const sorted = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return { text: sorted.map(word => word.text).join(' '), words: sorted,
      confidence: sorted.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / sorted.length,
      bbox: { x0: Math.min(...sorted.map(word => word.bbox.x0)), y0: Math.min(...sorted.map(word => word.bbox.y0)), x1: Math.max(...sorted.map(word => word.bbox.x1)), y1: Math.max(...sorted.map(word => word.bbox.y1)) } };
  });
}

