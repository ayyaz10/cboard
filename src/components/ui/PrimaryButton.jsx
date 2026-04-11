export function PrimaryButton({ children, type = 'button' }) {
  return (
    <button
      type={type}
      className="inline-flex w-full items-center justify-center rounded-full border-2 border-black bg-[#c5ff6f] px-5 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[4px_4px_0_#000] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_#000] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-black/15 sm:w-auto"
    >
      {children}
    </button>
  );
}
