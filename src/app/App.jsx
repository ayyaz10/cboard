import { HomePage } from '../components/pages/HomePage';
import { NotFoundPage } from '../components/pages/NotFoundPage';
import { ToolLayout } from '../components/layout/ToolLayout';
import { useHashRoute } from './useHashRoute';
import {
  calculators,
  findCalculatorByPath,
} from '../features/calculators/registry';

export default function App() {
  const route = useHashRoute();

  if (route === '/') {
    return <HomePage calculators={calculators} />;
  }

  const activeCalculator = findCalculatorByPath(route);

  if (!activeCalculator) {
    return <NotFoundPage />;
  }

  const ActiveCalculatorComponent = activeCalculator.component;

  return (
    <ToolLayout
      activeCalculator={activeCalculator}
      calculators={calculators}
    >
      <ActiveCalculatorComponent />
    </ToolLayout>
  );
}
