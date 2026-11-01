import { useEffect, useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getPreference, setPreference } from '../../services/preferenceService.js';
import { notify } from '../../lib/notifications.js';
import { ArrowRight, Grid2X2, PanelsTopLeft, Rows3 } from 'lucide-react';
import { PageShell } from '../layout/PageShell';
import { dashboardModules } from '../layout/appModules.js';
import { DASHBOARD_VIEW_SIZES, DEFAULT_DASHBOARD_VIEW_SIZE, normalizeDashboardViewSize } from '../layout/dashboardLayout.js';

const VIEW_KEY = 'cboard:dashboard-view-size:v1';

export function AppBoard({ calculators }) {
  const { user } = useAuth();
  const [viewSize, setViewSize] = useState(DEFAULT_DASHBOARD_VIEW_SIZE);
  const viewSizeRef = useRef(viewSize);
  const userIdRef = useRef(user?.id);
  const saveQueue = useRef(Promise.resolve());
  const viewChangeRef = useRef(0);
  viewSizeRef.current = viewSize;
  userIdRef.current = user?.id;

  useEffect(() => {
    let active = true;
    const startingRevision = viewChangeRef.current;
    setViewSize(DEFAULT_DASHBOARD_VIEW_SIZE);
    viewSizeRef.current = DEFAULT_DASHBOARD_VIEW_SIZE;
    getPreference(VIEW_KEY, DEFAULT_DASHBOARD_VIEW_SIZE).then(value => {
      if (!active || viewChangeRef.current !== startingRevision) return;
      const stored = normalizeDashboardViewSize(value);
      viewSizeRef.current = stored;
      setViewSize(stored);
    }).catch(error => {
      if (active) notify.error(`Dashboard view could not be loaded: ${error.message || 'Please try again.'}`);
    });
    return () => { active = false; };
  }, [user?.id]);

  function saveViewSize(next) {
    const previous = viewSizeRef.current;
    if (previous === next) return;
    viewChangeRef.current += 1;
    const owner = user?.id;
    viewSizeRef.current = next;
    setViewSize(next);
    const operation = saveQueue.current.catch(() => {}).then(() => {
      if (userIdRef.current !== owner) return;
      return setPreference(VIEW_KEY, next);
    });
    saveQueue.current = operation;
    operation.catch(error => {
      if (userIdRef.current === owner && viewSizeRef.current === next) {
        viewSizeRef.current = previous;
        setViewSize(previous);
      }
      notify.error(`Dashboard view could not be saved: ${error.message || 'Please try again.'}`);
    });
  }

  const viewIcons = { small: Grid2X2, medium: PanelsTopLeft, large: Rows3 };
  return (
    <PageShell>
      <section className="panel app-board-panel">
        <header className="app-board-heading">
          <div>
            <h1>CBoard</h1>
            <p>Pick a workspace to get started.</p>
          </div>
          <div className="app-board-view-control">
            <span>View</span>
            <div className="dashboard-view-options" role="group" aria-label="Dashboard view size">
              {DASHBOARD_VIEW_SIZES.map(option => {
                const ViewIcon = viewIcons[option];
                return <button key={option} type="button" aria-label={`${option[0].toUpperCase() + option.slice(1)} view`} aria-pressed={viewSize === option} onClick={() => saveViewSize(option)}>
                  <ViewIcon size={15} aria-hidden="true" /><span>{option[0].toUpperCase() + option.slice(1)}</span>
                </button>;
              })}
            </div>
          </div>
        </header>

        <div className="dashboard-grid" data-view-size={viewSize} role="list" aria-label="CBoard workspaces">
          {dashboardModules.map(module => <article key={module.id} className="board-card theme-color-card" role="listitem" data-theme-color={module.colorKey} style={{ '--theme-card-bg': module.color }}>
              <a href={getAppHref(module.path)} className="board-card-link">
                <p className="board-card-label">{module.label}</p>
                <h2>{module.name}</h2>
                <p className="board-card-description">{module.description}</p>
                <span className="board-card-footer">
                  <span className="board-card-tag">{module.id === 'calculator-board' ? `${calculators.length} calculators` : module.countLabel}</span>
                  <ArrowRight className="board-card-arrow" size={19} aria-hidden="true" />
                </span>
              </a>
            </article>)}
        </div>
      </section>
    </PageShell>
  );
}
