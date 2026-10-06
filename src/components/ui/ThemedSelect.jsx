import { useEffect, useRef, useState } from 'react';

function makeChangeEvent(value, name, id) {
  return {
    target: {
      id,
      name,
      value,
    },
  };
}

export function ThemedSelect({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = 'Select',
  disabled = false,
  className = '',
  ariaInvalid,
  ariaDescribedBy,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  function selectOption(nextValue) {
    onChange?.(makeChangeEvent(nextValue, name, id));
    setIsOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onClick={() => setIsOpen((current) => !current)}
        className={`ui-control ui-select-trigger flex items-center justify-between gap-3 pr-4 text-left font-semibold disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
      >
        <span className="min-w-0 truncate">
          {selectedOption?.label ?? placeholder}
        </span>
        <span
          className={`ui-select-arrow flex h-8 w-8 shrink-0 items-center justify-center transition ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          v
        </span>
      </button>

      {isOpen ? (
        <div
          role="listbox"
          aria-labelledby={id}
          className="ui-popover absolute left-0 right-0 z-40 mt-2 max-h-72 overflow-y-auto p-2"
        >
          {options.map((option) => {
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => selectOption(option.value)}
                className={`ui-select-option mb-2 flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold transition last:mb-0 ${isSelected ? 'is-selected' : ''}`}
              >
                <span className="min-w-0 break-words">{option.label}</span>
                {isSelected ? (
                  <span className="ui-select-selected rounded-full px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.12em]">
                    Set
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
