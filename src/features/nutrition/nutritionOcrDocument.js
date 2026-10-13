const mojibake=/[ÃÂâ]/;

function repairEncoding(value='') {
  if(!mojibake.test(value))return value;
  try {
    const chars=Array.from(value);
    if(chars.some(char=>char.charCodeAt(0)>255))return value;
    const bytes=Uint8Array.from(chars,char=>char.charCodeAt(0));
    const repaired=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return repaired.includes('\uFFFD')?value:repaired;
  } catch { return value; }
}

function cellText(html='') {
  return repairEncoding(html.replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi,(_,code)=>String.fromCodePoint(parseInt(code,16)))
    .replace(/\s+/g,' ').trim());
}

function tableRows(html='') {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([,row])=>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([,cell])=>cellText(cell))
  ).filter(row=>row.length);
}

const containsBasisHeaders=row=>row.some(cell=>/\b100\s*g\b/i.test(cell))&&row.some(cell=>/\b30\s*g\b/i.test(cell));
const hasEnergyPair=row=>row.some(cell=>/\bk\s*j\b/i.test(cell))&&row.some(cell=>/\bkcal\b/i.test(cell));
const isEnergyLabel=value=>/\b(?:energy|calories|calorific\s+value|valor\s+energetic[oa]|energia)\b/i.test(repairEncoding(value).normalize('NFD').replace(/[\u0300-\u036f]/g,''));

function meaningfulCells(cells) {
  return cells.map(cell=>cell.replace(/\s+/g,' ').trim());
}

/** Convert PaddleOCR-VL's table block to the existing nutrition parser's row input. */
export function paddleDocumentToNutritionInput(payload) {
  const document=payload?.document?.res||payload?.document||payload?.res||payload;
  const blocks=document?.parsing_res_list||[];
  const tableBlocks=blocks.filter(block=>block.block_label==='table'&&typeof block.block_content==='string');
  const tableDetections=document?.layout_det_res?.boxes||[];
  const lines=[];
  let rawText='';
  for(const block of blocks) {
    const content=repairEncoding(String(block.block_content||''));
    if(block.block_label==='table') {
      rawText+=content+'\n';
      const rows=tableRows(content);
      const headerIndex=rows.findIndex(containsBasisHeaders);
      if(headerIndex<0)continue;
      const detection=tableDetections.find(item=>item.label==='table'&&(!block.block_bbox||JSON.stringify(item.coordinate)===JSON.stringify(block.block_bbox)));
      const detectionConfidence=Number.isFinite(detection?.score)?detection.score:null;
      // PaddleOCR-VL returns a table-region confidence, not a confidence for
      // each numeric cell. Keep the candidate conservative and retain the
      // separate region score as evidence instead of misusing it as OCR score.
      const confidence=65;
      const header=meaningfulCells(rows[headerIndex]);
      // Some VL parses place the energy name in the same cell row as bare
      // column headings. Keep basis discovery on a heading-only line so the
      // nutrition parser never treats a nutrient row as a basis declaration.
      lines.push({text:header.slice(1).join(' | '),source:'paddleocr-vl-table-header',bbox:block.block_bbox||null,confidence,tableDetectionConfidence:detectionConfidence});
      let shiftedLabel=null,shiftedEnergyHeader=false;
      for(const rawRow of rows.slice(headerIndex+1)) {
        const row=meaningfulCells(rawRow);
        const label=row[0]||'';
        if(!row.slice(1).some(value=>/[\d]/.test(value)))continue;
        let selectedLabel=label;
        if(hasEnergyPair(row.slice(1))) {
          const energyHeader=isEnergyLabel(header[0]);
          const rowLabelIsEnergy=isEnergyLabel(label);
          selectedLabel=energyHeader&&!rowLabelIsEnergy?header[0]:label||header[0]||'Energy';
          shiftedEnergyHeader=energyHeader&&!rowLabelIsEnergy&&Boolean(label);
          shiftedLabel=shiftedEnergyHeader?label:null;
        } else if(shiftedEnergyHeader&&shiftedLabel) {
          selectedLabel=shiftedLabel;
          shiftedLabel=label&&label!==selectedLabel?label:null;
          if(!shiftedLabel)shiftedEnergyHeader=false;
        }
        if(!selectedLabel)continue;
        lines.push({text:[selectedLabel,...row.slice(1)].filter(Boolean).join(' | '),source:'paddleocr-vl-table-row',bbox:block.block_bbox||null,confidence,tableDetectionConfidence:detectionConfidence,rawCells:row});
      }
    } else if(content) rawText+=content+'\n';
  }
  if(!lines.length) {
    for(const block of blocks) {
      const content=repairEncoding(String(block.block_content||''));
      if(content)for(const text of content.split(/\r?\n/).map(value=>value.trim()).filter(Boolean))lines.push({text,source:'paddleocr-vl-ocr',bbox:block.block_bbox||null});
    }
  }
  return {lines,text:lines.map(line=>line.text).join('\n'),rawText:rawText.trim(),tableCount:tableBlocks.length,document};
}
