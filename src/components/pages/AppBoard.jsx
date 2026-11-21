import { useEffect, useRef, useState } from 'react';
import { requireSupabase } from '../../lib/supabaseClient.js';
import { getAppHref, navigateTo } from '../../app/useRoute';
import { useAuth } from '../../contexts/AuthContext';
import { getPreference, setPreference } from '../../services/preferenceService.js';
import { loadDashboardPreferences, saveDashboardPreferences, DashboardPreferenceConflictError } from '../../services/dashboardPreferenceService.js';
import { notify } from '../../lib/notifications.js';
import { ArrowRight, Grid2X2, PanelsTopLeft, Rows3 } from 'lucide-react';
import { PageShell } from '../layout/PageShell';
import { dashboardModules } from '../layout/appModules.js';
import { DASHBOARD_VIEW_SIZES, DEFAULT_DASHBOARD_VIEW_SIZE, normalizeDashboardViewSize } from '../layout/dashboardLayout.js';
import { QuickCaptureReminder } from './QuickCaptureReminder.jsx';
import { TodayDashboard } from '../../features/todayDashboard/TodayDashboard.jsx';
import { MyLifeOverview } from '../../features/myLife/MyLifeOverview.jsx';
import { useLifeOverview } from '../../features/myLife/useLifeOverview.js';
import { DashboardCustomization } from '../../features/todayDashboard/DashboardCustomization.jsx';
import { DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_PREFERENCES_KEY, getWidgetRequirements, normalizeDashboardPreferences } from '../../features/todayDashboard/dashboardWidgets.js';
import { Button } from '../ui/Button.jsx';

const VIEW_KEY = 'cboard:dashboard-view-size:v1';
const ALL_SUMMARY_KEYS = ['finance', 'training', 'goals', 'weight', 'food'];

export function AppBoard({ calculators }) {
  const { user } = useAuth();
  const [viewSize, setViewSize] = useState(DEFAULT_DASHBOARD_VIEW_SIZE);
  const [boardView, setBoardView] = useState('today'), [customizing, setCustomizing] = useState(false);
  const [refreshReminders, setRefreshReminders] = useState(() => () => {});
  const [dashboardLayout, setDashboardLayout] = useState(() => structuredClone(DEFAULT_DASHBOARD_LAYOUT));
  const [dashboardLoading, setDashboardLoading] = useState(true), [dashboardSaving, setDashboardSaving] = useState(false), [dashboardError, setDashboardError] = useState('');
  const dataKeys = boardView === 'mylife' ? ALL_SUMMARY_KEYS : getWidgetRequirements(dashboardLayout);
  const { sections: lifeSections, refresh: refreshLife } = useLifeOverview(dashboardLoading ? undefined : user?.id, dataKeys);
  const viewSizeRef = useRef(viewSize), userIdRef = useRef(user?.id), saveQueue = useRef(Promise.resolve()), viewChangeRef = useRef(0);
  const dashboardLayoutRef = useRef(dashboardLayout), savedLayoutRef = useRef(structuredClone(DEFAULT_DASHBOARD_LAYOUT)), preferenceUpdatedAt = useRef(null), dashboardSaveQueue = useRef(Promise.resolve());
  const dashboardSaveEpoch = useRef(0), dashboardPending = useRef(false), dashboardDirty = useRef(false), loadSequence = useRef(0);
  viewSizeRef.current = viewSize; userIdRef.current = user?.id; dashboardLayoutRef.current = dashboardLayout;

  useEffect(() => {
    let active = true;
    const startingRevision = viewChangeRef.current;
    setViewSize(DEFAULT_DASHBOARD_VIEW_SIZE); viewSizeRef.current = DEFAULT_DASHBOARD_VIEW_SIZE; setBoardView('today');
    getPreference(VIEW_KEY, DEFAULT_DASHBOARD_VIEW_SIZE).then(value => {
      if (!active || viewChangeRef.current !== startingRevision) return;
      const stored = normalizeDashboardViewSize(value); viewSizeRef.current = stored; setViewSize(stored);
    }).catch(error => { if (active) notify.error(`Dashboard view could not be loaded: ${error.message || 'Please try again.'}`); });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    const account = user?.id, sequence = ++loadSequence.current; let active = true;
    dashboardDirty.current = false; dashboardPending.current = false; dashboardSaveEpoch.current++;
    preferenceUpdatedAt.current = null; setDashboardLoading(true); setDashboardSaving(false); setDashboardError('');
    setDashboardLayout(structuredClone(DEFAULT_DASHBOARD_LAYOUT)); dashboardLayoutRef.current = structuredClone(DEFAULT_DASHBOARD_LAYOUT);
    if (!account) { setDashboardLoading(false); return undefined; }
    loadDashboardPreferences(calculators).then(result => {
      if (!active || loadSequence.current !== sequence || userIdRef.current !== account) return;
      const normalized = normalizeDashboardPreferences(result.preferences, calculators);
      preferenceUpdatedAt.current = result.updatedAt; savedLayoutRef.current = normalized; dashboardLayoutRef.current = normalized; setDashboardLayout(normalized); setDashboardLoading(false);
    }).catch(error => {
      if (!active || loadSequence.current !== sequence || userIdRef.current !== account) return;
      setDashboardError(`Dashboard preferences could not be loaded: ${error.message || 'Please retry.'}`); setDashboardLoading(false);
    });
    return () => { active = false; loadSequence.current++; };
  }, [user?.id, calculators]);

  useEffect(() => {
    if (!user?.id || dashboardLoading) return undefined;
    let client; try { client = requireSupabase(); } catch { return undefined; }
    const account = user.id;
    const channel = client.channel(`dashboard-preferences:${account}`).on('postgres_changes', { event: '*', schema: 'public', table: 'user_tool_preferences', filter: `user_id=eq.${account}` }, payload => {
      if (payload.new?.key && payload.new.key !== DASHBOARD_PREFERENCES_KEY) return;
      if (dashboardDirty.current || dashboardPending.current) return;
      loadDashboardPreferences(calculators).then(result => {
        if (userIdRef.current !== account || dashboardDirty.current || dashboardPending.current) return;
        const normalized = normalizeDashboardPreferences(result.preferences, calculators);
        preferenceUpdatedAt.current = result.updatedAt; savedLayoutRef.current = normalized; dashboardLayoutRef.current = normalized; setDashboardLayout(normalized); setDashboardError('');
      }).catch(error => { if (userIdRef.current === account) setDashboardError(`The latest dashboard layout could not be loaded: ${error.message || 'Please retry.'}`); });
    }).subscribe();
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible' || dashboardDirty.current || dashboardPending.current) return;
      loadDashboardPreferences(calculators).then(result => {
        if (userIdRef.current !== account || dashboardDirty.current || dashboardPending.current) return;
        const normalized = normalizeDashboardPreferences(result.preferences, calculators);
        preferenceUpdatedAt.current = result.updatedAt; savedLayoutRef.current = normalized; dashboardLayoutRef.current = normalized; setDashboardLayout(normalized); setDashboardError('');
      }).catch(error => { if (userIdRef.current === account) setDashboardError(`The latest dashboard layout could not be loaded: ${error.message || 'Please retry.'}`); });
    };
    window.addEventListener('focus', refreshWhenVisible); document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => { window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); client.removeChannel(channel); };
  }, [user?.id, dashboardLoading, calculators]);

  function saveDashboardLayout(nextLayout) {
    if (!user?.id) return Promise.resolve(false);
    const owner = user.id, payload = normalizeDashboardPreferences(nextLayout, calculators);
    dashboardLayoutRef.current = payload; setDashboardLayout(payload); dashboardDirty.current = true; dashboardPending.current = true;
    setDashboardSaving(true); setDashboardError('');
    const epoch = dashboardSaveEpoch.current;
    const operation = dashboardSaveQueue.current.catch(() => false).then(async () => {
      if (userIdRef.current !== owner || dashboardSaveEpoch.current !== epoch) return false;
      const result = await saveDashboardPreferences(payload, preferenceUpdatedAt.current);
      if (userIdRef.current !== owner || dashboardSaveEpoch.current !== epoch) return false;
      preferenceUpdatedAt.current = result.updatedAt; savedLayoutRef.current = normalizeDashboardPreferences(result.preferences, calculators);
      dashboardPending.current = false;
      dashboardDirty.current = JSON.stringify(dashboardLayoutRef.current) !== JSON.stringify(savedLayoutRef.current);
      setDashboardSaving(dashboardDirty.current);
      return true;
    }).catch(async error => {
      if (userIdRef.current !== owner || dashboardSaveEpoch.current !== epoch) return false;
      dashboardSaveEpoch.current++; dashboardPending.current = false; setDashboardSaving(false);
      if (error instanceof DashboardPreferenceConflictError || error?.code === 'DASHBOARD_PREFERENCE_CONFLICT') {
        try {
          const latest = await loadDashboardPreferences(calculators);
          if (userIdRef.current !== owner) return false;
          const normalized = normalizeDashboardPreferences(latest.preferences, calculators);
          preferenceUpdatedAt.current = latest.updatedAt; savedLayoutRef.current = normalized; dashboardLayoutRef.current = normalized; setDashboardLayout(normalized);
          dashboardDirty.current = false;
          setDashboardError('Another device saved a newer dashboard layout. The latest version is now loaded.');
        } catch (readError) { setDashboardError(`Dashboard changes conflicted and the latest layout could not be loaded: ${readError.message || 'Please refresh.'}`); }
      } else {
        dashboardDirty.current = true;
        setDashboardError(`Dashboard changes could not be confirmed: ${error?.message || 'Check your connection, then retry.'}`);
      }
      return false;
    });
    dashboardSaveQueue.current = operation;
    return operation;
  }
  function changeDashboardLayout(next) {
    if (dashboardLoading) return;
    const normalized = normalizeDashboardPreferences(next, calculators);
    dashboardLayoutRef.current = normalized; setDashboardLayout(normalized);
    dashboardDirty.current = JSON.stringify(normalized) !== JSON.stringify(savedLayoutRef.current);
    setDashboardError('');
  }
  async function finishDashboardEditing() {
    if (!dashboardDirty.current || await saveDashboardLayout(dashboardLayoutRef.current)) setCustomizing(false);
  }  async function retryDashboardSave() { if (dashboardDirty.current && await saveDashboardLayout(dashboardLayoutRef.current)) setCustomizing(false); }
  function reloadDashboard() {
    const owner = user?.id; if (!owner) return;
    setDashboardLoading(true);
    loadDashboardPreferences(calculators).then(result => {
      if (userIdRef.current !== owner) return;
      const normalized = normalizeDashboardPreferences(result.preferences, calculators);
      preferenceUpdatedAt.current = result.updatedAt; dashboardLayoutRef.current = normalized; setDashboardLayout(normalized);
      dashboardDirty.current = false; dashboardPending.current = false; setDashboardError(''); setDashboardLoading(false);
    }).catch(error => { if (userIdRef.current === owner) { setDashboardError(`Dashboard preferences could not be loaded: ${error.message || 'Please retry.'}`); setDashboardLoading(false); } });
  }
  function restoreDashboardDefaults() { changeDashboardLayout(structuredClone(DEFAULT_DASHBOARD_LAYOUT)); }
  function saveViewSize(next) {
    const previous = viewSizeRef.current; if (previous === next) return;
    viewChangeRef.current += 1; const owner = user?.id; viewSizeRef.current = next; setViewSize(next);
    const operation = saveQueue.current.catch(() => {}).then(() => { if (userIdRef.current !== owner) return; return setPreference(VIEW_KEY, next); });
    saveQueue.current = operation;
    operation.catch(error => { if (userIdRef.current === owner && viewSizeRef.current === next) { viewSizeRef.current = previous; setViewSize(previous); } notify.error(`Dashboard view could not be saved: ${error.message || 'Please try again.'}`); });
  }

  const viewIcons = { small: Grid2X2, medium: PanelsTopLeft, large: Rows3 };
  return <PageShell>
    <QuickCaptureReminder userId={user?.id} onSaved={() => refreshReminders()} />
    <nav className="today-view-switch" aria-label="CBoard view">
      <Button variant={boardView === 'today' ? 'primary' : 'secondary'} aria-pressed={boardView === 'today'} onClick={() => setBoardView('today')}>Today</Button>
      <Button variant={boardView === 'mylife' ? 'primary' : 'secondary'} aria-pressed={boardView === 'mylife'} onClick={() => setBoardView('mylife')}>My Life</Button>
      <Button variant={boardView === 'modules' ? 'primary' : 'secondary'} aria-pressed={boardView === 'modules'} onClick={() => setBoardView('modules')}>Modules</Button><Button variant="secondary" onClick={() => navigateTo('/life-areas')}>Life Areas</Button>
    </nav>
    {dashboardError && !customizing && <div className="today-dashboard-alert" role="alert"><span>{dashboardError}</span><Button onClick={() => dashboardDirty.current ? retryDashboardSave() : reloadDashboard()}>{dashboardDirty.current ? 'Retry save' : 'Retry'}</Button></div>}
    {customizing && boardView === 'today' && <DashboardCustomization layout={dashboardLayout} calculators={calculators} onChange={changeDashboardLayout} onReset={restoreDashboardDefaults} onDone={finishDashboardEditing} saveStatus={dashboardLoading ? 'saving' : dashboardSaving ? 'saving' : dashboardError && dashboardDirty.current ? 'error' : dashboardDirty.current ? 'unsaved' : dashboardError ? 'conflict' : 'saved'} saveError={dashboardError} onRetry={retryDashboardSave}/>}
    {dashboardLoading && boardView === 'today' && <p role="status" className="dashboard-load-note">Loading your saved layout. Daily actions remain available.</p>}
    {boardView === 'today' ? <TodayDashboard userId={user?.id} layout={dashboardLayout} calculators={calculators} customizationDisabled={dashboardLoading} onCustomize={() => setCustomizing(value => !value)} lifeSections={lifeSections} onRefreshLife={refreshLife} onOpenModules={() => setBoardView('modules')} onRefreshReady={setRefreshReminders}/> : boardView === 'mylife' ? <MyLifeOverview sections={lifeSections} onRefresh={() => refreshLife(ALL_SUMMARY_KEYS)}/> : <section className="panel app-board-panel">
      <header className="app-board-heading"><div><h1>CBoard</h1><p>Pick a workspace to get started.</p></div><div className="app-board-view-control"><span>View</span><div className="dashboard-view-options" role="group" aria-label="Dashboard view size">{DASHBOARD_VIEW_SIZES.map(option => { const ViewIcon = viewIcons[option]; return <button key={option} type="button" aria-label={`${option[0].toUpperCase() + option.slice(1)} view`} aria-pressed={viewSize === option} onClick={() => saveViewSize(option)}><ViewIcon size={15} aria-hidden="true"/><span>{option[0].toUpperCase() + option.slice(1)}</span></button>; })}</div></div></header>
      <div className="dashboard-grid" data-view-size={viewSize} role="list" aria-label="CBoard workspaces">{dashboardModules.map(module => <article key={module.id} className="board-card theme-color-card" role="listitem" data-theme-color={module.colorKey} style={{ '--theme-card-bg': module.color }}><a href={getAppHref(module.path)} className="board-card-link"><p className="board-card-label">{module.label}</p><h2>{module.name}</h2><p className="board-card-description">{module.description}</p><span className="board-card-footer"><span className="board-card-tag">{module.id === 'calculator-board' ? `${calculators.length} calculators` : module.countLabel}</span><ArrowRight className="board-card-arrow" size={19} aria-hidden="true"/></span></a></article>)}</div>
    </section>}
  </PageShell>;
}
