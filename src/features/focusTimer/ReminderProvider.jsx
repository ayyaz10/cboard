import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo } from '../../app/useRoute';
import { getActiveFocusSession } from '../../services/focusSessionService';
import {
  focusSessionStatuses,
  formatTimer,
  getPhaseRemainingSeconds,
} from './focusTimerHelpers';
import { formatReminderInterval, reminderCountdown } from './reminderHelpers';
import { readReminderState, reminderReducer } from './reminderHistoryState.js';
import { availableReminderPresets, readReminderPresets } from './reminderPresetData.js';

const ReminderContext = createContext(null);
export const useReminders = () => useContext(ReminderContext);

export function ReminderProvider({ children }) {
  const { user } = useAuth();
  return <ReminderStore key={user?.id || 'signed-out'} userId={user?.id}>{children}</ReminderStore>;
}

function ReminderStore({ userId, children }) {
  const storageKey = `cboard:reminders:${userId}`;
  const [storageError, setStorageError] = useState('');
  const [state, dispatch] = useReducer(reminderReducer, null, () => {
    try { return readReminderState(userId ? localStorage.getItem(storageKey) : null, Date.now()); }
    catch { return { reminders: [], history: [] }; }
  });
  const { reminders, history } = state;
  const [now, setNow] = useState(Date.now);
  const presetStorageKey = `cboard:reminder-presets:${userId}`;
  const [presets, setPresets] = useState(() => userId
    ? readReminderPresets(localStorage.getItem(presetStorageKey)) : []);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [liveFocusSession, setLiveFocusSession] = useState(null);
  const liveDockStorageKey = `cboard:live-timers-visible:${userId}`;
  const [liveDockVisible, setLiveDockVisible] = useState(() => {
    if (!userId) return true;
    try { return localStorage.getItem(liveDockStorageKey) !== 'false'; }
    catch { return true; }
  });
  const audio = useRef(null);
  const announced = useRef(new Set());
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setStorageError('');
    } catch {
      setStorageError('This browser could not save reminders and history. Keep this page open; refreshing may lose the latest changes.');
    }
  }, [state, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      dispatch({ type: 'tick', now: timestamp });
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    try { localStorage.setItem(liveDockStorageKey, String(liveDockVisible)); }
    catch { /* The visibility choice can safely reset if browser storage is unavailable. */ }
  }, [liveDockStorageKey, liveDockVisible, userId]);

  useEffect(() => {
    if (!userId) {
      setLiveFocusSession(null);
      return undefined;
    }

    let active = true;
    getActiveFocusSession()
      .then((session) => {
        if (active) setLiveFocusSession(session);
      })
      .catch(() => {
        // The reminder dock remains available if focus-session storage is unavailable.
      });

    const syncFocusSession = (event) => setLiveFocusSession(event.detail?.session || null);
    window.addEventListener('cboard:focus-session-changed', syncFocusSession);
    return () => {
      active = false;
      window.removeEventListener('cboard:focus-session-changed', syncFocusSession);
    };
  }, [userId]);

  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);

  useEffect(() => {
    const syncPresets = (event) => {
      if (event?.detail?.userId === userId && Array.isArray(event.detail.presets)) {
        setPresets(event.detail.presets);
        return;
      }
      setPresets(readReminderPresets(localStorage.getItem(presetStorageKey)));
    };
    window.addEventListener('cboard:reminder-presets-changed', syncPresets);
    window.addEventListener('storage', syncPresets);
    return () => {
      window.removeEventListener('cboard:reminder-presets-changed', syncPresets);
      window.removeEventListener('storage', syncPresets);
    };
  }, [presetStorageKey, userId]);

  function prepareSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!audio.current || audio.current.state === 'closed') audio.current = new AudioContext();
      audio.current.resume().catch(() => {});
    } catch { /* Visual alerts remain available when sound is unsupported. */ }
  }

  function playSound() {
    try {
      const context = audio.current;
      if (!context || context.state !== 'running') return;
      for (let index = 0; index < 3; index += 1) {
        const start = context.currentTime + index * 0.45;
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        tone.connect(gain);
        gain.connect(context.destination);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
        tone.start(start);
        tone.stop(start + 0.35);
      }
    } catch { /* The persistent on-screen alert is the fallback. */ }
  }

  useEffect(() => {
    const unseen = reminders.filter((item) => item.status === 'ringing'
      && !announced.current.has(`${item.id}:${item.alertAt ?? item.dueAt}`));
    if (!unseen.length) return;
    const newlyDue = unseen.filter((item) => (item.alertAt ?? item.dueAt) > mountedAt.current);
    for (const item of unseen) {
      announced.current.add(`${item.id}:${item.alertAt ?? item.dueAt}`);
    }
    if (!newlyDue.length) return;
    setWidgetOpen(true);
    playSound();
    for (const item of newlyDue) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Reminder', { body: item.title, tag: item.id });
        }
      } catch { /* Some mobile browsers do not support the notification constructor. */ }
    }
  }, [reminders]);

  function addReminder(title, duration, repeats = false) {
    prepareSound();
    const timestamp = Date.now();
    dispatch({ type: 'add', now: timestamp, item: {
      id: crypto.randomUUID(), title, dueAt: timestamp + duration, status: 'waiting',
      repeatMs: repeats ? duration : 0, durationMs: duration,
    } });
  }

  function dismiss(id) { dispatch({ type: 'dismiss', id, now: Date.now() }); }
  function cancel(id) { dispatch({ type: 'cancel', id, now: Date.now() }); }
  function snooze(id) {
    prepareSound();
    dispatch({ type: 'snooze', id, now: Date.now() });
  }

  const ringing = reminders.filter((item) => item.status === 'ringing');
  const liveReminders = [...reminders]
    .filter((item) => item.status === 'waiting' || item.status === 'ringing')
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'ringing' ? -1 : 1;
      return left.dueAt - right.dueAt;
    });
  const focusRemaining = liveFocusSession
    ? getPhaseRemainingSeconds(liveFocusSession, now)
    : 0;
  const focusIsBreak = liveFocusSession && [
    focusSessionStatuses.activeBreak,
    focusSessionStatuses.pausedBreak,
  ].includes(liveFocusSession.status);
  const focusIsPaused = liveFocusSession && [
    focusSessionStatuses.pausedFocus,
    focusSessionStatuses.pausedBreak,
  ].includes(liveFocusSession.status);
  const liveTimerCount = liveReminders.length + (liveFocusSession ? 1 : 0);
  const availablePresets = availableReminderPresets(presets, reminders);
  const selectedPreset = availablePresets.find((preset) => preset.id === selectedPresetId)
    || availablePresets[0] || null;
  const openReminder = (repeats) => {
    setWidgetOpen(false);
    navigateTo(`/focus-timer#reminders-${repeats ? 'repeat' : 'once'}`);
  };
  const finishAlert = (action, id) => {
    action(id);
    if (ringing.length === 1) setWidgetOpen(false);
  };
  return (
    <ReminderContext.Provider value={{ reminders, history, now, addReminder, dismiss, cancel, snooze, prepareSound, playSound, storageError }}>
      {children}
      {userId && liveTimerCount > 0 && liveDockVisible && !widgetOpen && (
        <aside aria-label="Live timers" className="ui-popover fixed right-3 top-20 z-[60] w-[min(20rem,calc(100vw-1.5rem))] p-3 sm:right-4 sm:top-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-30" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--color-accent)]" />
              </span>
              <p className="text-xs font-black uppercase tracking-[0.16em]">Live timers</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="ui-badge">{liveTimerCount}</span>
              <button type="button" onClick={() => setLiveDockVisible(false)} aria-label="Hide live timers" title="Hide live timers" className="ui-button ui-button--sm h-8 w-8 p-0">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                  <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 8a9.7 9.7 0 0 1-2 3.8M6.6 6.6C4.4 8 3 10.2 3 12c0 3 3.5 8 9 8 1.2 0 2.3-.2 3.3-.7" />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-2">
            {liveFocusSession && (
              <button type="button" onClick={() => navigateTo('/focus-timer')} className="ui-button ui-button--sm w-full justify-between text-left" aria-label={`Open ${focusIsBreak ? 'break' : 'focus'} timer for ${liveFocusSession.title}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black">{liveFocusSession.title}</span>
                  <span className="block text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    {focusRemaining === 0 && !focusIsPaused ? `${focusIsBreak ? 'Break' : 'Focus'} finished` : `${focusIsPaused ? 'Paused ' : ''}${focusIsBreak ? 'break' : 'focus'}`}
                  </span>
                </span>
                <span role="timer" aria-live="off" className="shrink-0 font-mono text-xl font-black tabular-nums">{formatTimer(focusRemaining)}</span>
              </button>
            )}

            {liveReminders.slice(0, liveFocusSession ? 1 : 2).map((item) => (
              <button type="button" key={item.id} onClick={() => setWidgetOpen(true)} className={`ui-button ui-button--sm w-full justify-between text-left ${item.status === 'ringing' ? 'ui-button--warning' : ''}`} aria-label={`Open reminder ${item.title}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black">{item.title}</span>
                  <span className="block text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">{item.status === 'ringing' ? 'Due now' : item.repeatMs > 0 ? 'Repeating reminder' : 'Reminder'}</span>
                </span>
                <span role="timer" aria-live="off" className="shrink-0 font-mono text-xl font-black tabular-nums">{item.status === 'ringing' ? 'DUE' : reminderCountdown(item.dueAt, now)}</span>
              </button>
            ))}

            {liveTimerCount > 2 && (
              <button type="button" onClick={() => setWidgetOpen(true)} className="text-center text-xs font-black underline decoration-2 underline-offset-2">
                +{liveTimerCount - 2} more active
              </button>
            )}
          </div>
        </aside>
      )}
      {widgetOpen && (
        <aside id="reminder-widget" aria-label="Reminders" className="ui-dialog reminder-widget fixed right-4 left-4 z-50 overflow-y-auto p-5 sm:left-auto sm:w-96">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold">Reminders</p>
              {ringing.length > 0 ? (
                <p role="alert" className="mt-1 text-sm font-bold">{ringing.length === 1 ? 'Your reminder is ready' : `${ringing.length} reminders are ready`}</p>
              ) : (
                <p className="mt-1 text-sm font-semibold text-[var(--color-text-secondary)]">Nothing is due right now.</p>
              )}
            </div>
            <button type="button" onClick={() => setWidgetOpen(false)} aria-label="Close reminders" className="ui-button ui-button--sm h-10 w-10 shrink-0 p-0">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {ringing.map((item) => (
            <div key={item.id} className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="break-words text-lg font-bold">{item.title}</p>
              {item.repeatMs > 0 && <p className="mt-1 text-xs font-semibold">Repeats every {formatReminderInterval(item.repeatMs)}. Dismiss keeps it running; snooze restarts the interval after 5 minutes.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => finishAlert(snooze, item.id)} aria-label={`Snooze ${item.title} for 5 minutes`} className="ui-button ui-button--sm">Snooze 5 min</button>
                <button type="button" onClick={() => finishAlert(dismiss, item.id)} aria-label={`Dismiss ${item.title}`} className="ui-button ui-button--danger ui-button--sm">Dismiss</button>
                {item.repeatMs > 0 && <button type="button" onClick={() => finishAlert(cancel, item.id)} aria-label={`Stop repeating ${item.title}`} className="ui-button ui-button--sm">Stop repeating</button>}
                <button type="button" onClick={() => openReminder(item.repeatMs > 0)} className="ui-button ui-button--sm">Open {item.repeatMs > 0 ? 'Repeat' : 'Just once'}</button>
              </div>
            </div>
          ))}
          <section aria-label="Start another preset" className="mt-4 border-t-2 border-[var(--color-border)] pt-4">
            <label htmlFor="alarm-preset-select" className="text-sm font-bold">Start another preset</label>
            {availablePresets.length > 0 ? <>
              <select id="alarm-preset-select" value={selectedPreset?.id || ''} onChange={(event) => setSelectedPresetId(event.target.value)} className="ui-control mt-2">
                {availablePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.title} · {preset.repeats ? 'Repeat every' : 'Once after'} {formatReminderInterval(preset.duration)}</option>)}
              </select>
              <button type="button" onClick={() => {
                if (!selectedPreset) return;
                addReminder(selectedPreset.title, selectedPreset.duration, selectedPreset.repeats);
                setSelectedPresetId('');
              }} className="ui-button ui-button--primary ui-button--sm mt-2">Turn on selected preset</button>
            </> : <p className="mt-2 text-xs font-semibold text-[var(--color-text-secondary)]">No other saved presets are available.</p>}
          </section>
          <button type="button" onClick={() => openReminder(false)} className="ui-button ui-button--sm mt-4 w-full">Open reminder settings</button>
        </aside>
      )}
      <button
        type="button"
        className={`ui-button reminder-toggle fixed right-4 z-50 min-h-12 gap-2 px-4 py-3 font-bold ${ringing.length > 0 ? 'ui-button--warning' : 'ui-button--primary'}`}
        aria-expanded={widgetOpen}
        aria-controls="reminder-widget"
        onClick={() => {
          if (liveTimerCount > 0 && !liveDockVisible) {
            setLiveDockVisible(true);
            return;
          }
          setWidgetOpen((open) => !open);
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        <span>{liveTimerCount > 0 && !liveDockVisible ? 'Show timers' : ringing.length > 0 ? `${ringing.length} due` : 'Reminders'}</span>
      </button>
    </ReminderContext.Provider>
  );
}
