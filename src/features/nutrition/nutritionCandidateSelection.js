import { nutritionConsistency } from './nutritionLabelParser.js';

const sameBasis=(a,b)=>a.kind===b.kind&&a.quantity===b.quantity&&a.unit===b.unit&&a.tableId===b.tableId;
const agrees=(a,b)=>Object.keys(a.nutrients).filter(key=>b.nutrients[key]?.value===a.nutrients[key].value&&b.nutrients[key]?.unit===a.nutrients[key].unit);

export function nutritionCandidatesAgree(results) {
  if(results.length<2)return false;
  const last=results.at(-1);
  return last.parsed.columns.length>0 && last.parsed.columns.every(column=>Object.keys(column.nutrients).length>=5&&!nutritionConsistency(column).length&&Object.values(column.nutrients).every(field=>field.confidence>=75&&!field.uncertain)) && results.slice(0,-1).some(other=>
    other.parsed.columns.length===last.parsed.columns.length&&last.parsed.columns.every((column,i)=>sameBasis(column,other.parsed.columns[i])&&Object.keys(column.nutrients).length===Object.keys(other.parsed.columns[i].nutrients).length&&agrees(column,other.parsed.columns[i]).length===Object.keys(column.nutrients).length));
}

export function finalizeNutritionCandidates(best, results) {
  // Keep the original candidate parses intact for diagnostics. Select coherent
  // tables; never manufacture a decimal from an energy estimate.
  best.parsed=structuredClone(best.parsed);
  for(const column of best.parsed.columns) {
    if(!column.confirmed && best.parsed.columns.length===1) {
      const contexts=results.filter(result=>result.parsed.columns.length===1).flatMap(result=>result.parsed.columns).filter(other=>other.confirmed&&agrees(column,other).length>=3);
      if(contexts.length && contexts.every(other=>sameBasis(other,contexts[0]))) {
        const {nutrients,id,tableId,warnings,...basis}=contexts[0];
        Object.assign(column,basis,{basisStatus:'identified'});
      }
    }
    const alternatives=results.filter(result=>result!==best&&result.score>=best.score-5).flatMap(result=>result.parsed.columns).filter(other=>sameBasis(column,other)&&!nutritionConsistency(other).length);
    for(const [key,field] of Object.entries(column.nutrients)) {
      field.candidate=best.name;
      // A poor OCR pass must not flag every good amount. Require a credible
      // competing table and numeric token; corroboration resolves a lone outlier.
      const supporting=alternatives.filter(other=>other.nutrients[key]?.value===field.value&&other.nutrients[key]?.confidence>=70);
      const conflicts=alternatives.map(other=>other.nutrients[key]).filter(other=>other&&other.value!==field.value&&other.confidence>=70&&!other.uncertain);
      if(conflicts.length&&!supporting.length) {
        field.uncertain=true;
        field.reasons=[...field.reasons,`OCR passes disagree (${[...new Set([field.value,...conflicts.map(other=>other.value)])].join(' or ')} ${field.unit}). Compare with the image.`];
      }
    }
    for(const issue of nutritionConsistency(column)) {
      const field=column.nutrients[issue.field];field.uncertain=true;field.reasons=[...field.reasons,issue.message];
    }
  }
}
