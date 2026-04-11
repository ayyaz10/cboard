export function InputField({
  id,
  name,
  label,
  placeholder,
  hint,
  value,
  onChange,
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

      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`field-input ${
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
