import { createImageOcrSession } from '../../services/ocr/imageOcr.js';
import { parseNutritionLabel, scoreNutritionCandidate } from './nutritionLabelParser.js';
import { nutritionCandidatesAgree, finalizeNutritionCandidates } from './nutritionCandidateSelection.js';

export function createNutritionOcrSession(onProgress) {
  return createImageOcrSession({
    layout:'nutrition', languages:'eng+spa+por', parse:parseNutritionLabel, score:scoreNutritionCandidate,
    shouldStop:nutritionCandidatesAgree,
    finalize:finalizeNutritionCandidates,
  },onProgress);
}
