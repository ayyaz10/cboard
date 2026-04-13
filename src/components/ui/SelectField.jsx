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

      <select
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`field-input cursor-pointer pr-10 ${
          error
            ? 'border-[#ff6b6b] bg-[#fff0f0]'
            : ''
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

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
