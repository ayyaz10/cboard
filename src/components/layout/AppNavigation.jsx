import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute';
import { primaryNavItems } from './appModules.js';

export { primaryNavItems } from './appModules.js';
const AppNavigationContext = createContext(false);
export const AppNavigationScope = AppNavigationContext.Provider;

const DESKTOP_NAV_COUNT = 4;

const relatedCalculators = {
  '/training': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
  ],
  '/recipes': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
    { path: '/calculators/calorie', label: 'Calorie portions' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/food-diary': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
    { path: '/calculators/calorie', label: 'Calorie portions' },
  ],
  '/groceries': [
    { path: '/calculators/calorie', label: 'Calorie portions' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/weight-progress': [
    { path: '/calculators/protein-intake', label: 'Protein calculator' },
    { path: '/calculators/mass', label: 'Unit converter' },
  ],
  '/progress-tracker': [
    { path: '/calculators/percentage', label: 'Percentage calculator' },
  ],
  '/finance': [
    { path: '/calculators/savings-planner', label: 'Savings goal planner' },
    { path: '/calculators/position-size', label: 'Position size' },
    { path: '/calculators/crypto-futures', label: 'Futures trade' },
    { path: '/calculators/percentage', label: 'Percentage calculator' },
  ],
};

function activeModulePath(route) {
  return primaryNavItems
    .filter(item => route === item.path || route.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path || '';
}

function NavLink({ item, activePath, onNavigate, className = '' }) {
  const active = activePath === item.path;
  return <a href={getAppHref(item.path)} aria-current={active ? 'page' : undefined} className={`global-nav-link${active ? ' is-active' : ''} ${className}`.trim()} onClick={onNavigate}>
    {item.label}
  </a>;
}

export function AppNavigation(props) {
  const nestedInShell = useContext(AppNavigationContext);
  return nestedInShell ? null : <AppNavigationView {...props} />;
}

function AppNavigationView({ route = '', activePath }) {
  const currentPath = activePath || activeModulePath(route);
  const overflowItems = primaryNavItems.slice(DESKTOP_NAV_COUNT);
  const activeInOverflow = overflowItems.some(item => currentPath === item.path);
  const [moreOpen, setMoreOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const moreRef = useRef(null);
  const drawerRef = useRef(null);
  const drawerTriggerRef = useRef(null);
  const drawerId = useId();

  useEffect(() => {
    if (!moreOpen && !drawerOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        if (drawerOpen) closeDrawer();
      }
    };
    const keepDrawerFocus = event => {
      if (event.key !== 'Tab' || !drawerOpen || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll('a[href],button:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const closeMoreOutside = event => {
      if (moreRef.current && !moreRef.current.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('keydown', keepDrawerFocus);
    document.addEventListener('pointerdown', closeMoreOutside);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('keydown', keepDrawerFocus);
      document.removeEventListener('pointerdown', closeMoreOutside);
    };
  }, [moreOpen, drawerOpen]);

  function openDrawer() {
    setDrawerOpen(true);
    requestAnimationFrame(() => drawerRef.current?.querySelector('button, a')?.focus());
  }
  function closeDrawer() {
    setDrawerOpen(false);
    requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }

  return <>
    <nav className="global-nav" aria-label="Main navigation">
      <div className="global-nav-primary">
        {primaryNavItems.slice(0, DESKTOP_NAV_COUNT).map(item => <NavLink key={item.path} item={item} activePath={currentPath} />)}
        <div className="global-nav-more" ref={moreRef}>
          <button type="button" className={`global-nav-link global-nav-more-trigger${activeInOverflow ? ' is-active' : ''}`} aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen(open => !open)}>
            More <span aria-hidden="true">⌄</span>
          </button>
          {moreOpen && <div className="global-nav-overflow" role="region" aria-label="More apps">
            {overflowItems.map(item => <NavLink key={item.path} item={item} activePath={currentPath} onNavigate={() => setMoreOpen(false)} className="global-nav-overflow-link" />)}
            {relatedCalculators[currentPath] && <div className="global-nav-related" aria-label="Related tools">
              <span>Related tools</span>
              {relatedCalculators[currentPath].map(item => <a key={item.path} href={getAppHref(item.path)} className="global-nav-overflow-link" onClick={() => setMoreOpen(false)}>{item.label}</a>)}
            </div>}
          </div>}
        </div>
      </div>
        <button ref={drawerTriggerRef} type="button" className="global-nav-menu-trigger" aria-label="Open navigation menu" title="Menu" aria-expanded={drawerOpen} aria-controls={drawerId} onClick={openDrawer}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        <span>Menu</span>
      </button>
    </nav>
    {drawerOpen && <div className="global-nav-drawer-layer">
      <button type="button" className="global-nav-backdrop" aria-label="Close navigation" onClick={closeDrawer} />
      <aside id={drawerId} ref={drawerRef} className="global-nav-drawer" role="dialog" aria-modal="true" aria-label="Application navigation">
        <div className="global-nav-drawer-heading"><strong>Navigate</strong><button type="button" aria-label="Close navigation" onClick={closeDrawer}>×</button></div>
        <nav aria-label="All apps" className="global-nav-drawer-links">
          {primaryNavItems.map(item => <NavLink key={item.path} item={item} activePath={currentPath} onNavigate={closeDrawer} />)}
        </nav>
        {relatedCalculators[currentPath] && <div className="global-nav-related"><span>Related tools</span>{relatedCalculators[currentPath].map(item => <a key={item.path} href={getAppHref(item.path)} className="global-nav-link" onClick={closeDrawer}>{item.label}</a>)}</div>}
      </aside>
    </div>}
  </>;
}
