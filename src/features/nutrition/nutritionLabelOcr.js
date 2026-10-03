import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { parseNutritionLabel, scoreNutritionCandidate } from './nutritionLabelParser.js';

export function createNutritionOcrSession(onProgress) {
  return createImageOcrSession({
    layout:'nutrition', parse:parseNutritionLabel, score:scoreNutritionCandidate,
    shouldStop(results) {
      if(results.length<2)return false;
      const last=results.at(-1);
      return last.parsed.columns.length>0 && last.parsed.columns.every(column=>column.confirmed && Object.keys(column.nutrients).length>=5 && Object.values(column.nutrients).every(value=>value.confidence>=75)) && results.slice(0,-1).some(other=>JSON.stringify(other.parsed.columns.map(column=>[column.kind,column.quantity,column.unit,Object.entries(column.nutrients).map(([key,value])=>[key,value.value])]))===JSON.stringify(last.parsed.columns.map(column=>[column.kind,column.quantity,column.unit,Object.entries(column.nutrients).map(([key,value])=>[key,value.value])])));
    },
    finalize(best,results) {
      for(const column of best.parsed.columns)for(const [key,value] of Object.entries(column.nutrients)) {
        const conflicts=results.slice(1).flatMap(result=>result.parsed.columns).filter(other=>other.kind===column.kind&&other.quantity===column.quantity&&other.unit===column.unit&&other.tableId===column.tableId).some(other=>other.nutrients[key]&&other.nutrients[key].value!==value.value);
        if(conflicts){value.uncertain=true;value.confidence=Math.min(50,value.confidence);}
      }
    },
  },onProgress);
}
