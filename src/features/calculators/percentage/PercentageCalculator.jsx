import { useState } from 'react';
import { InputField } from '../../../components/ui/InputField';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import {
  buildPercentageResult,
  createEmptyPercentageForm,
  percentageFieldConfig,
  validatePercentageForm,
} from './percentageMath';

export function PercentageCalculator() {
  const [formValues, setFormValues] = useState(createEmptyPercentageForm);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);

  const runCalculation = (nextValues) => {
    const validationErrors = validatePercentageForm(nextValues);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setResult(null);
      return;
    }

    setResult(buildPercentageResult(nextValues));
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    runCalculation(formValues);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
      <form
        noValidate
        onSubmit={handleSubmit}
        className="rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 sm:p-6"
      >
        <div className="grid gap-5">
          {percentageFieldConfig.map((field) => (
            <InputField
              key={field.name}
              id={field.name}
              name={field.name}
              label={field.label}
              placeholder={field.placeholder}
              value={formValues[field.name]}
              onChange={handleChange}
              error={errors[field.name]}
            />
          ))}
        </div>

        <div className="mt-6">
          <PrimaryButton type="submit">Calculate</PrimaryButton>
        </div>
      </form>

      <aside
        aria-live="polite"
        className="rounded-[1.75rem] border-2 border-black bg-[#ff90e8] p-5 text-black sm:p-6"
      >
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/60">
          Result
        </p>

        <div className="mt-4 min-h-[5rem] break-words text-4xl font-bold tracking-[-0.06em] text-black sm:min-h-[6rem] sm:text-5xl lg:text-6xl">
          {result ? result.formattedValue : '--'}
        </div>
      </aside>
    </div>
  );
}
