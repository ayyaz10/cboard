import { BrandBadge } from './BrandBadge';

export function PageShell({ children }) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:py-6">
        <BrandBadge />
        {children}
      </div>
    </main>
  );
}
