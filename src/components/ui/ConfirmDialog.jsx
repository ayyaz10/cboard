export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="ui-overlay fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel?.(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="ui-dialog w-full max-w-md p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="pill">Confirm</span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close confirmation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-black bg-white text-xl font-bold leading-none text-black shadow-[3px_3px_0_#000] hover:bg-[#c5ff6f]"
          >
            ×
          </button>
        </div>

        <h2
          id="confirm-dialog-title"
          className="mt-5 text-3xl font-bold tracking-[-0.05em] text-black"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-black/70">
          {message}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border-2 border-black bg-white px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full border-2 border-black bg-[#ffe0de] px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000] transition hover:bg-[#ffb4ad]"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
