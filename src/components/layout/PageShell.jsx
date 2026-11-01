import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Play } from 'lucide-react';
import { ScrollControls } from './ScrollControls';
import { BrandBadge } from './BrandBadge';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../../contexts/AuthContext';
import { useRoute, getAppHref } from '../../app/useRoute';
import { AppNavigation, AppNavigationScope } from './AppNavigation.jsx';
import { WorkspaceTools } from './WorkspaceTools.jsx';
import { ProfileMenu } from './ProfileMenu.jsx';
import './appShell.css';

export function PageShell({ children }) {
  const { user } = useAuth();
  const route = useRoute();
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const headerRef = useRef(null);

  useEffect(() => {
    if (!utilitiesOpen) return undefined;
    const close = event => {
      if (event.key === 'Escape' || (headerRef.current && !headerRef.current.contains(event.target))) setUtilitiesOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [utilitiesOpen]);

  return (
    <main className="page-shell min-h-screen px-4 pb-6 sm:px-6 lg:px-8">
      <div className="page-shell-layout mx-auto flex max-w-6xl flex-col gap-4">
        <header className="app-shell-header" ref={headerRef} data-utilities-open={utilitiesOpen}>
          <div className="app-shell-header-row">
            <BrandBadge />
            <AppNavigation route={route} />
            {user && <a href={getAppHref('/focus-timer')} className="app-shell-focus" title="Start a focus session" aria-label="Start a focus session"><Play size={14} fill="currentColor" aria-hidden="true" /><span className="app-shell-focus-label">Focus</span></a>}
            <button type="button" className="app-shell-utilities-trigger" aria-label="Open quick tools" title="Quick tools" aria-expanded={utilitiesOpen} aria-controls="app-shell-utilities" onClick={() => setUtilitiesOpen(value => !value)}><Ellipsis size={18} aria-hidden="true" /><span>Tools</span></button>
            <div className="app-shell-utilities" id="app-shell-utilities" role="group" aria-label="Quick tools">
              {user && <WorkspaceTools key={user.id} userId={user.id} route={route} />}
              <ThemeToggle />
              <div id="app-shell-status" />
            </div>
            {user && <ProfileMenu />}
          </div>
        </header>
        <AppNavigationScope value={true}>{children}</AppNavigationScope>
        <ScrollControls />
      </div>
    </main>
  );
}
