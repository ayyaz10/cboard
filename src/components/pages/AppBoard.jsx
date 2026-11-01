import { useEffect, useRef, useState } from 'react';
import { getAppHref } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getPreference, setPreference } from '../../services/preferenceService.js';
import { notify } from '../../lib/notifications.js';
import { PageShell } from '../layout/PageShell';
import { dashboardModules } from '../layout/appModules.js';
import { DASHBOARD_CARD_SIZES, normalizeDashboardCardSizes, updateDashboardCardSize } from '../layout/dashboardLayout.js';

const SIZE_KEY = 'cboard:dashboard-card-sizes:v1';

export function AppBoard({ calculators }) {
  const { user } = useAuth();
  const [sizes, setSizes] = useState({});
  const sizesRef = useRef(sizes);
  const userIdRef = useRef(user?.id);
  const saveQueue = useRef(Promise.resolve());
  sizesRef.current = sizes;
  userIdRef.current = user?.id;

  useEffect(() => {
    let active = true;
    setSizes({});
    sizesRef.current = {};
    getPreference(SIZE_KEY, {}).then(value => {
      if (!active) return;
      const stored = normalizeDashboardCardSizes(value, dashboardModules);
      sizesRef.current = stored;
      setSizes(stored);
    }).catch(error => {
      if (active) notify.error(`Dashboard card sizes could not be loaded: ${error.message || 'Please try again.'}`);
    });
    return () => { active = false; };
  }, [user?.id]);

  function saveSizes(next) {
    const previous = sizesRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const snapshot = { ...next };
    const owner = user?.id;
    sizesRef.current = snapshot;
    setSizes(snapshot);
    const operation = saveQueue.current.catch(() => {}).then(() => {
      if (userIdRef.current !== owner) return;
      return setPreference(SIZE_KEY, snapshot);
    });
    saveQueue.current = operation;
    operation.catch(error => {
      if (userIdRef.current === owner && sizesRef.current === snapshot) {
        sizesRef.current = previous;
        setSizes(previous);
      }
      notify.error(`Dashboard layout could not be saved: ${error.message || 'Please try again.'}`);
    });
  }

  function setCardSize(id, size) {
    saveSizes(updateDashboardCardSize(sizesRef.current, id, size, dashboardModules));
  }

  const hasCustomSizes = Object.keys(sizes).length > 0;
  return (
    <PageShell>
      <section className="panel app-board-panel">
        <header className="app-board-heading">
          <div>
            <h1>CBoard</h1>
            <p>Pick a workspace to get started.</p>
          </div>
          <details className="app-board-settings">
            <summary aria-label="Dashboard settings" title="Dashboard settings">⋯</summary>
            <div className="app-board-settings-menu">
              <strong>Dashboard settings</strong>
              <button type="button" disabled={!hasCustomSizes} onClick={() => saveSizes({})}>Reset card sizes</button>
            </div>
          </details>
        </header>

        <div className="dashboard-grid" aria-label="CBoard workspaces">
          {dashboardModules.map(module => {
            const size = sizes[module.id] || 'medium';
            return <article key={module.id} className="board-card theme-color-card" data-card-size={size} data-theme-color={module.colorKey} style={{ '--theme-card-bg': module.color }}>
              <a href={getAppHref(module.path)} className="board-card-link">
                <p className="board-card-label">{module.label}</p>
                <h2>{module.name}</h2>
                <p className="board-card-description">{module.description}</p>
                <span className="board-card-footer">
                  <span className="board-card-tag">{module.id === 'calculator-board' ? `${calculators.length} calculators` : module.countLabel}</span>
                  <span className="board-card-arrow" aria-hidden="true">→</span>
                </span>
              </a>
              <details className="board-card-size-menu">
                <summary aria-label={`Set ${module.name} card size`} title="Card size">⋯</summary>
                <div className="board-card-size-options" aria-label={`${module.name} card size`}>
                  <strong>Card size</strong>
                  {DASHBOARD_CARD_SIZES.map(option => <button key={option} type="button" aria-pressed={size === option} onClick={event => {
                    setCardSize(module.id, option);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}>{option[0].toUpperCase() + option.slice(1)}</button>)}
                </div>
              </details>
            </article>;
          })}
        </div>
      </section>
    </PageShell>
  );
}
