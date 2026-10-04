// Transcription of the user's attached Aldi website screenshot. The screenshot
// contains no visible nutrition basis. Real-image OCR is checked separately by
// scripts/check-nutrition-image.cjs, using the user's local file (not committed).
export const aldiText=`Energy kJ 162.8 kJ
Energy kcal 38.9 kcal
Fat 0.5 g
Saturates 0 g
Sugars 6.1 g
Fibre 3.8 g
Protein 0.6 g
Salt 0 g
Carbohydrate 6.1 g`;
export const aldiExpected={energyKJ:162.8,calories:38.9,fat:.5,saturatedFat:0,sugars:6.1,fiber:3.8,protein:.6,salt:0,carbs:6.1};
