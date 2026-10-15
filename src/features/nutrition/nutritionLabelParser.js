import { NUTRIENTS, matchCanonicalNutrientPrefix, normalizeNutrientLabel } from './nutrients.js';
const units = Object.fromEntries(NUTRIENTS.map(([key, , unit]) => [key, unit]));
const mass = {g:1, mg:.001, ug:.000001, mcg:.000001};
const heading = /^\s*(?:nutrition(?:al)?(?:\s+(?:information|facts|values))?|typical\s+values|average\s+values)(?:\s+(?:per|for)\b.*)?\s*:?\s*$/i;
const noise = /^(?:ingredients?|allerg(?:en|y)|storage|store\s|cooking|directions|manufacturer|recycl|serving\s+suggestion|reference\s+intake|percent\s+daily|\*|keep\s)/i;
const cleanUnit = unit => unit.toLowerCase().replace(/[µμ]/g, 'u');

function xAt(line, offset) {
  if (!line.words?.length) return null;
  let at = 0;
  for (const word of line.words) {
    const end = at + word.text.length;
    if (offset <= end) return word.bbox.x0 + Math.max(0, Math.min(1, (offset-at)/word.text.length)) * (word.bbox.x1-word.bbox.x0);
    at = end + 1;
  }
  return line.words.at(-1).bbox.x1;
}

function servingInfo(text) {
  const match = text.match(/(?:serving\s*size\s*:?|(?:1|one)\s+(?:serving|portion)\s*=|(?:1\s+)?(?:slice|scoop|pot|container)\s*\(|per\s+(?:serving|portion)\s*\(?)\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/i);
  if (match) return {quantity:Number(match[1].replace(',','.')), unit:match[2].toLowerCase(), description:match[0].replace(/[(:=]\s*$/, '').slice(0,120)};
  const count = text.match(/(?:serving\s*size\s*:?\s*)?(half\s+pack|1\s+(?:pot|slice|scoop|container|pack))\b/i);
  return count ? {quantity:1,unit:'pieces',description:count[1]} : null;
}

function findBases(line, serving) {
  const bases=[];
  const pattern=/\b(?:per|por)\s+(?:(\d+(?:[.,]\d+)?)\s*(g|ml)\b(?:\s*(?:serving|portion|por[cç][aã]o))?|(?:(?:1|one)\s+)?(serving|portion|item|pack|slice|scoop|container|pot|por[cç][aã]o)\b(?:\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\s*\)?)?)/gi;
  for (const match of line.text.matchAll(pattern)) {
    const kind = match[3]?.toLowerCase() || (Number(match[1])===100 ? `100${match[2].toLowerCase()}` : 'portion');
    const known = match[1] ? {quantity:Number(match[1].replace(',','.')),unit:match[2].toLowerCase()} : match[4] ? {quantity:Number(match[4].replace(',','.')),unit:match[5].toLowerCase()} : ['serving','portion'].includes(kind) && serving ? serving : {quantity:1,unit:'pieces'};
    bases.push({label:match[0],kind,...known,serving:!kind.startsWith('100') ? {...known,description:match[0]} : serving, x:xAt(line,match.index), confirmed:true});
  }
  // EU wrappers often print bare columns such as "100 g  30 g  %RI".
  // Only accept these as bases on a header-only row, never on nutrient rows.
  const isNutrientRow=Boolean(matchCanonicalNutrientPrefix(line.text));
  if (!bases.length && !isNutrientRow) {
    const quantities=[...line.text.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(g|ml)\b/gi)]
      .filter(match=>!/%[^\d]*$/.test(line.text.slice(0,match.index)));
    if (quantities.length>=2) for (const match of quantities) {
      const quantity=Number(match[1].replace(',','.')),unit=match[2].toLowerCase();
      if (!Number.isFinite(quantity)||quantity<=0) continue;
      const kind=quantity===100?`100${unit}`:'portion';
      const known={quantity,unit};
      bases.push({label:`Per ${quantity} ${unit}`,kind,...known,serving:quantity!==100?{...known,description:`${quantity} ${unit}`} : serving,x:xAt(line,match.index),confirmed:true});
    }
  }
  return bases;
}

function parseNutritionNumber(raw) {
  let normalized = raw.replace(/\s/g, '').replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/gi, '5');
  const commas = (normalized.match(/,/g) || []).length;
  const dots = (normalized.match(/\./g) || []).length;
  if (commas && dots) {
    // Use the final separator as the decimal mark and strip the other as grouping.
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.'))
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    else normalized = normalized.replace(/,/g, '');
  } else if (commas) {
    const groups = normalized.split(',');
    const thousands = groups.length > 1 && groups[0].length <= 3 && groups[0] !== '0' && groups.slice(1).every(group => group.length === 3);
    normalized = thousands ? groups.join('') : groups.length === 2 ? groups.join('.') : '';
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function valuesIn(line, offset) {
  const values=[];
  // A percent sign belongs to its number, never to a nutrient quantity.
  const pattern=/(<?\s*)(-?[\dOIlS]+(?:\s*[.,]\s*[\dOIlS]+)*)\s*(kcal|kJ|mcg|[µμu]g|mg|g|%|ml)?/gi;
  for (const match of line.text.slice(offset).matchAll(pattern)) {
    const start=offset+match.index;
    const before=line.text[start+match[1].length-1],after=line.text[start+match[0].length];
    if ((before && /[a-z]/i.test(before)) || (after && /[a-z]/i.test(after))) continue;
    const raw=match[2], unit=cleanUnit(match[3] || '');
    if (unit==='%' || /%/.test(line.text.slice(start+match[0].length).match(/^\s*%/)?.[0] || '')) continue;
    if (!/\d/.test(raw) && !unit) continue;
    const value=parseNutritionNumber(raw);
    if (value==null || value<0) continue;
    let at=0;
    const numberStart=start+match[1].length, numberEnd=numberStart+raw.length;
    const tokenWords=(line.words||[]).filter(word=>{const begin=at;at+=word.text.length+1;return begin<numberEnd && at-1>numberStart;});
    // Spacing around an actual punctuation token is safe to remove. A large
    // horizontal gap may instead separate columns; never bridge that gap.
    if (/[.,]/.test(raw) && tokenWords.some((word,i)=>i && word.bbox.x0-tokenWords[i-1].bbox.x1 > Math.max(word.bbox.y1-word.bbox.y0,tokenWords[i-1].bbox.y1-tokenWords[i-1].bbox.y0)*.8)) continue;
    const digits=tokenWords.filter(word=>/[\dOIlS]/.test(word.text));
    const confidence=digits.length?digits.reduce((sum,word)=>sum+(word.confidence??60)*word.text.length,0)/digits.reduce((sum,word)=>sum+word.text.length,0):line.confidence??80;
    const repairedCharacters=/[OIlS]/i.test(raw),upperBound=match[1].includes('<');
    values.push({value,unit,raw:match[0].trim(),x:xAt(line,numberStart),confidence,uncertain:repairedCharacters||upperBound,upperBound,repairedCharacters,decimal:/[.,]/.test(raw)});
  }
  return values;
}

function amountField(key, value, label) {
  if(key==='calories')return value.unit==='kcal'||!value.unit&&/^calories$/i.test(label)?['calories','kcal',value.value]:null;
  if(key==='energyKJ') {
    if(value.unit==='kj')return ['energyKJ','kJ',value.value];
    if(value.unit==='kcal')return ['calories','kcal',value.value];
    return null;
  }
  if (key==='energy') {
    if (value.unit==='kj') return ['energyKJ','kJ',value.value];
    if (value.unit==='kcal' || (!value.unit && /^calories/i.test(label))) return ['calories','kcal',value.value];
    return null;
  }
  const expected=cleanUnit(units[key] || '');
  if (!value.unit) return expected === 'g' ? [key,units[key],value.value] : null;
  if (!(value.unit in mass) || !(expected in mass)) return null;
  return [key,units[key],Number((value.value*mass[value.unit]/mass[expected]).toPrecision(12))];
}

export function parseNutritionLabel(input) {
  const lines=(typeof input==='string' ? input.split(/\r?\n/).map(text=>({text})) : input.lines?.length ? input.lines : String(input.text||'').split(/\r?\n/).map(text=>({text})))
    .map(line=>({...line,text:line.text.trim()})).filter(line=>line.text);
  const tables=[],parserWarnings=[];let table=null, stopped=false, pendingHeading=false, pendingMicronutrients=false, serving=null;
  function newTable(bases=[]) {
    table={id:`table-${tables.length+1}`,columns:(bases.length?bases:[{label:'Basis not identified',kind:'unknown',quantity:null,unit:'g',confirmed:false,serving}]).map((basis,i)=>({...basis,id:`table-${tables.length+1}-column-${i+1}`,nutrients:{}})),warnings:[],rows:0};
    tables.push(table);stopped=false;pendingHeading=false;return table;
  }
  for (const line of lines) {
    if (heading.test(line.text)) { pendingHeading=Boolean(table?.rows); stopped=false; }
    if (/^\s*micronutrients?\b/i.test(line.text)) { pendingMicronutrients=true; pendingHeading=false; stopped=false; }
    const info=servingInfo(line.text); if(info)serving=info;
    const bases=findBases(line,serving);
    if (bases.length) {
      const sameBasis=table&&bases.length===table.columns.length&&bases.every((basis,index)=>basis.quantity===table.columns[index].quantity&&basis.unit===table.columns[index].unit&&basis.kind===table.columns[index].kind);
      if (pendingMicronutrients&&sameBasis) { pendingMicronutrients=false; pendingHeading=false; stopped=false; continue; }
      pendingMicronutrients=false;
      if (!table || table.rows || pendingHeading) newTable(bases);
      else table.columns=bases.map((basis,i)=>({...basis,id:`${table.id}-column-${i+1}`,nutrients:{}}));
      continue;
    }
    if (/serving\s*size/i.test(line.text) && info) {
      if (!table || pendingHeading) newTable([{label:`Per serving (${info.quantity} ${info.unit})`,kind:'serving',...info,serving:info,confirmed:true}]);
      else if (!table.rows && table.columns[0].kind==='unknown') Object.assign(table.columns[0],{label:`Per serving (${info.quantity} ${info.unit})`,kind:'serving',...info,serving:info,confirmed:true});
      continue;
    }
    if (noise.test(line.text)) { stopped=true; continue; }
    if (stopped) continue;
    const decorationClean=line.text.replace(/^\s*(?:[↳↓↪➜→•▪◦└├]+|[-*]+)\s*/, '');
    const decorationOffset=line.text.length-decorationClean.length;
    const rowUnit=line.rawUnit||line.text.match(/[\dOIlS]+(?:\s*[.,]\s*[\dOIlS]+)*\s*(kcal|kJ|mcg|[ÂµÎ¼u]g|mg|g|ml)\b/i)?.[1];
    const resolved=line.rawLabel
      ? matchCanonicalNutrientPrefix(line.rawLabel,{category:line.category,unit:rowUnit})
      : matchCanonicalNutrientPrefix(decorationClean,{category:line.category,unit:rowUnit});
    if(!resolved)continue;
    const key=resolved.nutrientId;
    const labelEnd=line.rawLabel ? (line.text.indexOf('|')>=0?line.text.indexOf('|')+1:line.text.length) : decorationOffset+resolved.labelEnd;
    const vals=valuesIn(line,labelEnd).filter(value=>amountField(key,value,resolved.rawLabel));
    if (!vals.length) continue;
    const valueFields=vals.map(value=>amountField(key,value,resolved.rawLabel)?.[0]);
    const duplicates=valueFields.filter((field,index)=>field&&valueFields.indexOf(field)!==index);
    if((table?.columns.length??1)===1&&duplicates.length){
      const warning=`Could not reliably read the decimal or separate numeric tokens for ${resolved.displayName}. Check this row in the image.`;
      parserWarnings.push(warning);table?.warnings.push(warning);
      continue;
    }
    if (!table || pendingHeading) newTable();
    // Repeated nutrient sets are separate tables, not an opportunity to mix values.
    const keys=vals.map(value=>amountField(key,value,resolved.rawLabel)[0]);
    if(table.rows>=3 && table.columns.every(column=>keys.every(key=>column.nutrients[key])))newTable(table.columns.map(({nutrients,id,...basis})=>basis));
    table.rows++;
    const columns=table.columns;
    for (const [index,value] of vals.entries()) {
      const [field,unit,amount]=amountField(key,value,resolved.rawLabel);
      let column;
      if(columns.length===1) column=columns[0];
      else if(value.x!=null && columns.every(col=>col.x!=null)) column=[...columns].sort((a,b)=>Math.abs(value.x-a.x)-Math.abs(value.x-b.x))[0];
      else {
        const sameField=vals.filter(item=>amountField(key,item,resolved.rawLabel)[0]===field);
        if(sameField.length===columns.length)column=columns[sameField.indexOf(value)];
        else {table.warnings.push(`Could not assign ${field} to a column. Enter it from the image.`);continue;}
      }
      const previous=column.nutrients[field];
      const missingUnit=!value.unit && !(field==='calories' && /^calories/i.test(resolved.rawLabel));
      const reasons=[...(value.repairedCharacters?['OCR confused a letter with a digit. Compare with the image.']:[]),...(value.upperBound?['The label gives an upper limit, not an exact amount.']:[]),...(missingUnit?['The unit was not read. Confirm the amount and unit.']:[]),...(value.confidence<70?['Low OCR confidence. Compare with the image.']:[])];
      const numericMatch=value.raw.match(/(-?[\dOIlS]+(?:\s*[.,]\s*[\dOIlS]+)*)\s*(kcal|kJ|mcg|[ÂµÎ¼u]g|mg|g|ml)?/i);
      const result={field,value:amount,unit,basis:column.id,rawText:line.text,rawLabel:line.rawLabel||resolved.rawLabel,normalizedLabel:normalizeNutrientLabel(line.rawLabel||resolved.rawLabel),rawValue:value.raw,rawNumericToken:numericMatch?.[1]?.replace(/\s/g,'')||value.raw,rawUnit:numericMatch?.[2]||value.unit,rawCells:line.rawCells||null,matchedAlias:resolved.matchedAlias,matchType:resolved.matchType,nutrientMatchConfidence:resolved.confidence,x:value.x,confidence:Math.min(value.confidence, value.uncertain||missingUnit?55:100),uncertain:value.uncertain||missingUnit,upperBound:value.upperBound,missingUnit,decimal:value.decimal,reasons,bbox:line.bbox||null};
      if(previous && previous.value!==amount) {previous.uncertain=true;previous.confidence=40;table.warnings.push(`Conflicting ${field} values. Check the image.`);}
      else column.nutrients[field]=result;
    }
  }
  const useful=tables.filter(value=>value.columns.some(column=>Object.keys(column.nutrients).length));
  const basisHint=lines.some(line=>/\bper\s+(?:[\dOIl]|serv|port|pack|item)|\b(?:serving|portion)\s+size/i.test(line.text));
  const columns=useful.flatMap(value=>value.columns.map(column=>({...column,tableId:value.id,basisStatus:column.confirmed?'identified':basisHint?'unreadable':'not-found',warnings:[...new Set(value.warnings)]})));
  return {columns,lines,text:lines.map(line=>line.text).join('\n'),warnings:[...parserWarnings,...(useful.length>1?['Multiple nutrition tables found. Choose the table and basis for this food.']:[]),...(!columns.length?['No useful nutrition values found. Crop to the label, rescan, or enter values manually.']:[])]};
}

export function scoreNutritionCandidate(parsed, confidence=0) {
  const scores=parsed.columns.map(column=>Object.values(column.nutrients).reduce((sum,field)=>sum+3+field.confidence/100+(field.missingUnit?-.8:.5)-(field.uncertain?1:0),0)+(column.confirmed?8:0)-column.warnings.length*3-nutritionConsistency(column).length*6);
  return {score:Math.max(0,...scores)+confidence/20};
}

// Deliberately broad tolerances: fibre, polyols and rounding change labelled
// energy. These are evidence of a suspect scan, never instructions to divide
// an amount by ten or impose a food-specific maximum.
export function nutritionConsistency(column) {
  const n=column.nutrients,issues=[];
  if(column.kind==='100g'&&column.unit==='g'){
    for(const key of ['protein','carbs','fat','fiber','sugars','saturatedFat','monounsaturatedFat','polyunsaturatedFat','transFat','water'])
      if(n[key]?.value>100)issues.push({field:key,message:`${key} is over 100 g per 100 g, which cannot be right. Check the source row; the value was not changed.`});
    for(const [key,limit] of [['iron',100],['zinc',100],['copper',100]])
      if(n[key]?.value>limit)issues.push({field:key,message:`${key} is unusually high per 100 g. Check the source row; the value was not changed.`});
  }
  const kcal=n.calories?.value;
  if(kcal!=null) {
    for(const [key,factor] of [['fat',9],['protein',4],['carbs',4],['fiber',2]]) {
      if(n[key]?.value*factor>kcal*1.7+15)issues.push({field:key,message:'This amount conflicts with the scanned calories. Compare both with the image.'});
    }
    if(['fat','protein','carbs'].every(key=>n[key]) && n.fat.value*9+n.protein.value*4+n.carbs.value*4>kcal*1.8+30 && !issues.length)
      issues.push({field:'calories',message:'Calories and macronutrient amounts disagree. Compare with the image.'});
    if(n.energyKJ && Math.abs(n.energyKJ.value/4.184-kcal)>Math.max(20,kcal*.2))
      issues.push({field:'energyKJ',message:'The kJ and kcal values disagree. Compare with the image.'});
  }
  for(const [part,total] of [['sugars','carbs'],['saturatedFat','fat']])if(n[part]&&n[total]&&n[part].value>n[total].value*1.15+1)
    issues.push({field:part,message:`This amount exceeds the scanned ${total==='carbs'?'carbohydrate':'fat'} amount. Compare with the image.`});
  return issues;
}

export function nutritionBasisConsistency(columns) {
  const issues=[];
  const per100=columns.filter(column=>column.kind==='100g'&&column.unit==='g'&&column.quantity===100);
  const portions=columns.filter(column=>column.kind==='portion'&&column.unit==='g'&&Number.isFinite(column.quantity));
  const displayStep=field=>{
    const match=String(field.rawValue||'').match(/[\dOIlS]+([.,]\d+)?/i);
    const decimals=match?.[1]?.slice(1).length||0;
    return 10**-decimals;
  };
  for(const source of per100)for(const portion of portions)for(const [field,observed] of Object.entries(portion.nutrients)) {
    const basisValue=source.nutrients[field];
    if(!basisValue||basisValue.value<0)continue;
    const expected=basisValue.value*portion.quantity/100;
    // Allow for independent rounding of both printed bases before reporting
    // a disagreement; rounded integer values can differ after scaling.
    const tolerance=displayStep(basisValue)*portion.quantity/200+displayStep(observed)/2+1e-6;
    if(Math.abs(observed.value-expected)<=tolerance)continue;
    const message=`${observed.value} ${observed.unit} per ${portion.quantity} g conflicts with ${basisValue.value} ${basisValue.unit} per 100 g (about ${Number(expected.toFixed(3))} ${observed.unit} expected). Compare with the image.`;
    observed.uncertain=true;
    observed.confidence=Math.min(observed.confidence??55,55);
    observed.reasons=[...new Set([...(observed.reasons||[]),message])];
    issues.push({field,column:portion.id,message});
  }
  return issues;
}
