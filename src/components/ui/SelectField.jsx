import { ThemedSelect } from './ThemedSelect';

export function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  options,
  hint,
  error,
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-xs font-bold uppercase tracking-[0.14em] text-black/70"
        >
          {label}
        </label>
      </div>

      <ThemedSelect
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        options={options}
        ariaInvalid={Boolean(error)}
        ariaDescribedBy={describedBy}
        className={`${
          error
            ? 'border-[#ff6b6b] bg-[#fff0f0]'
            : ''
        }`}
      />

      {hint ? (
        <p id={hintId} className="mt-2 text-sm font-medium leading-6 text-black/55">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-2 text-sm font-semibold leading-6 text-[#b42318]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
