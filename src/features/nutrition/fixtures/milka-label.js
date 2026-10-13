// Human transcription of the visible Milka wrapper table supplied with the
// OCR issue. The source photo is not checked in because it was only present
// inline in the conversation, but this keeps table/column/decimal behavior
// reproducible without claiming to be an OCR image fixture.
export const milkaLabelText = `Informacion Nutricional / Declaracao Nutricional
100 g  30 g  %* 30 g
Energia / Valor energetico 2234 kJ / 535 kcal 670 kJ / 160 kcal
Grasas / Lipidos 31 g 9,3 g 13%
de las cuales saturadas / dos quais saturados 18 g 5,3 g 27%
Hidratos de carbono 56 g 17 g 6%
de los cuales azucares / dos quais acucares 43 g 13 g 14%
Fibra alimentaria / Fibra 2,8 g 0,8 g
Proteinas 6,7 g 2,0 g
Sal 0,28 g 0,08 g 1%`;

export const milkaExpected = {
  energyKJ: 2234, calories: 535, fat: 31, saturatedFat: 18,
  carbs: 56, sugars: 43, fiber: 2.8, protein: 6.7, salt: .28,
};
