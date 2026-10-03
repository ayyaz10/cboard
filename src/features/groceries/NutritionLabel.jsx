import { NutritionLabelScan } from '../nutrition/NutritionLabelScan';
export function NutritionLabel({onSelect,current,basisUnits}) {
  return <NutritionLabelScan initialOpen basisUnits={basisUnits} current={current} onApply={onSelect}/>;
}
