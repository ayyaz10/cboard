import { useEffect, useState } from 'react';
export function ScrollControls() {
  const [useful, setUseful] = useState(false);
  useEffect(() => {
    const update = () => setUseful(document.documentElement.scrollHeight > window.innerHeight * 1.6);
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener('resize', update); update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  if (!useful) return null;
  const scroll = bottom => window.scrollTo({ top: bottom ? document.documentElement.scrollHeight : 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  return <nav className="global-scroll-controls" aria-label="Page scroll"><button type="button" aria-label="Go to top" onClick={() => scroll(false)}>↑ Top</button><button type="button" aria-label="Go to bottom" onClick={() => scroll(true)}>↓ Bottom</button></nav>;
}
