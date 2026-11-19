import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { navigateTo, useRoute } from '../../app/useRoute';
import { getActiveFocusSession } from '../../services/focusSessionService';
import {
  focusSessionStatuses,
  formatTimer,
  getPhaseRemainingSeconds,
} from './focusTimerHelpers';
import {
  formatReminderAlertDate,
  formatReminderDate,
  formatReminderInterval,
  reminderCountdown,
  reminderPaymentDueDate,
  reminderTitle,
} from './reminderHelpers';
import { readReminderState, reminderReducer } from './reminderHistoryState.js';
import { availableReminderPresets, readReminderPresets } from './reminderPresetData.js';
import { isReminderDue } from './reminderHelpers.js';
import { eventFor } from './reminderHistoryState.js';
import {
  applyFocusTimerReminderAction, beginFocusTimerOccurrence, createReminderId,
  importFocusTimerHistory, importFocusTimerReminder, listFocusTimerHistory,
  listFocusTimerReminders, subscribeFocusTimerReminders,
} from '../../services/focusReminderSync.js';

const ReminderContext = createContext(null);
export const useReminders = () => useContext(ReminderContext);

export function ReminderProvider({ children }) {
  const { user } = useAuth();
  return <ReminderStore key={user?.id || 'signed-out'} userId={user?.id}>{children}</ReminderStore>;
}

export function ReminderStore({ userId, children }) {
  const route = useRoute();
  const storageKey = `cboard:reminders:${userId}`;
  const [storageError, setStorageError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [cloudReady, setCloudReady] = useState(!userId);
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
  const reminderToggleRef = useRef(null);
  const reminderCloseRef = useRef(null);
  const focusRestoreRef = useRef(null);
  const stateRef = useRef(state);
  const cloudReadyRef = useRef(!userId);
  const refreshFlightRef = useRef(null);
  const historyKeysRef = useRef(new Set());
  const syncingIdsRef = useRef(new Set());
  const beginningRef = useRef(new Set());
  stateRef.current = state;
  cloudReadyRef.current = cloudReady;

  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      setStorageError('');
    } catch {
      setStorageError('This browser could not save reminders and history. Keep this page open; refreshing may lose the latest changes.');
    }
  }, [state, storageKey, userId]);
  const importAndReconcile = useCallback(async (item) => {
    let saved = await importFocusTimerReminder(item);
    const latest = stateRef.current;
    const current = latest.reminders.find(entry => entry.id === item.id);
    const terminal = latest.history.filter(event => event.reminderId === item.id
      && (['cancelled', 'stopped'].includes(event.type) || (event.type === 'dismissed' && !event.repeatMs)))
      .sort((left, right) => right.at - left.at)[0];
    if (terminal && !current && !saved.completedAt) {
      const action = terminal.type === 'dismissed' ? 'dismiss' : 'cancel';
      const result = await applyFocusTimerReminderAction(item.id, action, terminal.expectedRevision || saved.revision, terminal.id);
      if (result.applied) historyKeysRef.current.add(terminal.id);
      else if (!result.reminder.completedAt) {
        dispatch({ type: 'removeHistoryEvent', id: terminal.id });
        throw new Error('A reminder changed on another device. The latest saved state will load on retry.');
      }
      saved = result.reminder;
    } else if (current && current.dueAt !== item.dueAt && item.status === 'ringing'
      && current.status === 'waiting' && !saved.completedAt) {
      const snooze = latest.history.filter(event => event.reminderId === item.id && event.type === 'snoozed')
        .sort((left, right) => right.at - left.at)[0];
      if (snooze) {
        const result = await applyFocusTimerReminderAction(item.id, 'snooze', snooze.expectedRevision || saved.revision, snooze.id);
        if (result.applied) historyKeysRef.current.add(snooze.id);
        else {
          dispatch({ type: 'removeHistoryEvent', id: snooze.id });
          throw new Error('A snooze conflicted with a newer reminder change. The latest saved due time will load on retry.');
        }
        saved = result.reminder;
      }
    }
    return saved;
  }, []);
  const refreshCloud = useCallback(() => {
    if (!userId) return Promise.resolve();
    if (refreshFlightRef.current) return refreshFlightRef.current;
    const request = (async () => {
      try {
        const local = stateRef.current;
        const imported = [];
        for (const item of local.reminders) imported.push(item.revision ? item : await importAndReconcile(item));

        const [listedReminders, remoteHistory] = await Promise.all([
          listFocusTimerReminders(), listFocusTimerHistory(),
        ]);
        const remoteReminders = [...listedReminders];
        const latestLocal = stateRef.current;
        let reconciliationError = false;
        for (let index = 0; index < remoteReminders.length; index += 1) {
          const saved = remoteReminders[index];
          const current = latestLocal.reminders.find(item => item.id === saved.id);
          const terminal = latestLocal.history.filter(event => event.reminderId === saved.id
            && (['cancelled', 'stopped'].includes(event.type) || (event.type === 'dismissed' && !event.repeatMs)))
            .sort((left, right) => right.at - left.at)[0];
          if (!terminal || current || saved.completedAt) continue;
          const action = terminal.type === 'dismissed' ? 'dismiss' : 'cancel';
          const result = await applyFocusTimerReminderAction(saved.id, action, terminal.expectedRevision || saved.revision, terminal.id);
          remoteReminders[index] = result.reminder;
          if (!result.applied && !result.reminder.completedAt) {
            dispatch({ type: 'removeHistoryEvent', id: terminal.id });
            reconciliationError = true;
            setSyncError('A reminder change could not be confirmed. The latest saved reminder is shown; retry the action if needed.');
          }
        }
        for (const event of remoteHistory) historyKeysRef.current.add(event.id);
        // A snooze saved during a lost response is retried with its original revision and idempotency key.
        for (let index = 0; index < remoteReminders.length; index += 1) {
          const saved = remoteReminders[index];
          const current = latestLocal.reminders.find(item => item.id === saved.id);
          const snooze = latestLocal.history.filter(event => event.reminderId === saved.id && event.type === 'snoozed')
            .sort((left, right) => right.at - left.at)[0];
          if (!snooze?.expectedRevision || !current || current.status !== 'waiting'
            || current.dueAt !== snooze.dueAt || historyKeysRef.current.has(snooze.id)) continue;
          if (saved.status === 'waiting' && saved.dueAt === snooze.dueAt) continue;
          if (saved.status !== 'ringing' || saved.revision !== snooze.expectedRevision) {
            dispatch({ type: 'removeHistoryEvent', id: snooze.id });
            reconciliationError = true;
            setSyncError('A snooze conflicted with a newer reminder change. The latest saved due time is shown.');
            continue;
          }
          const result = await applyFocusTimerReminderAction(saved.id, 'snooze', snooze.expectedRevision, snooze.id);
          remoteReminders[index] = result.reminder;
          if (result.applied) historyKeysRef.current.add(snooze.id);
          else {
            dispatch({ type: 'removeHistoryEvent', id: snooze.id });
            reconciliationError = true;
            setSyncError('A snooze conflicted with a newer reminder change. The latest saved due time is shown.');
          }
        }
        const actionEvents = new Set(['snoozed', 'dismissed', 'cancelled', 'stopped']);
        const activeById = new Map(remoteReminders.filter(item => !item.completedAt).map(item => [item.id, item]));
        const missingHistory = latestLocal.history.filter(event => !historyKeysRef.current.has(event.id)
          && (!actionEvents.has(event.type) || !activeById.has(event.reminderId)
            || ((event.type === 'snoozed' || (event.type === 'dismissed' && event.repeatMs > 0))
              && activeById.get(event.reminderId).status === 'waiting'
              && activeById.get(event.reminderId).dueAt === event.dueAt)));
        if (missingHistory.length) {
          await importFocusTimerHistory(missingHistory);
          for (const event of missingHistory) historyKeysRef.current.add(event.id);
        }
        const canonical = new Map(remoteReminders.map(item => [item.id, item]));
        for (const item of imported) if (!canonical.has(item.id)) canonical.set(item.id, item);
        const allRows = [...canonical.values()];
        for (const item of allRows) if (item.revision) syncingIdsRef.current.add(item.id);
        const activeRows = allRows.filter(item => !item.completedAt);
        dispatch({ type: 'replaceAll', reminders: activeRows, history: remoteHistory });
        if (!reconciliationError) setSyncError('');
        setCloudReady(true);
        cloudReadyRef.current = true;
        for (const item of activeRows) {
          if (item.status === 'waiting' && item.dueAt <= Date.now()) beginningRef.current.delete(item.id + ':' + item.dueAt);
        }
        return activeRows;
      } catch (error) {
        setSyncError(error.message || 'Could not sync reminders. They remain saved on this device.');
        throw error;
      }
    })();
    refreshFlightRef.current = request;
    request.finally(() => { if (refreshFlightRef.current === request) refreshFlightRef.current = null; }).catch(() => {});
    return request;
  }, [importAndReconcile, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    let unsubscribe = null;
    const refresh = () => { void refreshCloud().catch(() => {}); };
    void refreshCloud().catch(() => {});
    subscribeFocusTimerReminders(userId, refresh, status => {
      if (status === 'SUBSCRIBED') refresh();
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) setSyncError('Live sync is disconnected. This screen will refresh when you return to it.');
    }).then(cleanup => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(error => setSyncError(error.message || 'Live reminder updates could not connect.'));
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      cloudReadyRef.current = false;
    };
  }, [refreshCloud, userId]);

  useEffect(() => {
    if (!userId || !cloudReady) return;
    for (const item of reminders) {
      if (item.revision || syncingIdsRef.current.has(item.id)) continue;
      syncingIdsRef.current.add(item.id);
      importAndReconcile(item).then(remote => {
        dispatch({ type: 'syncReminder', reminder: remote });
        if (remote.completedAt) setSyncError('A reminder changed on another device; the latest saved state was restored.');
        else setSyncError('');
      }).catch(error => {
        syncingIdsRef.current.delete(item.id);
        setSyncError(error.message || 'Reminder save could not be confirmed. It remains saved on this device.');
      });
    }
  }, [cloudReady, importAndReconcile, reminders, userId]);

  useEffect(() => {
    if (!userId || !cloudReady) return;
    const actionTypes = new Set(['snoozed', 'dismissed', 'cancelled', 'stopped']);
    const missing = history.filter(event => !actionTypes.has(event.type) && !historyKeysRef.current.has(event.id));
    if (!missing.length) return;
    importFocusTimerHistory(missing).then(() => {
      for (const event of missing) historyKeysRef.current.add(event.id);
      setSyncError('');
    }).catch(error => setSyncError(error.message || 'Reminder history could not sync. It remains saved on this device.'));
  }, [cloudReady, history, userId]);

  useEffect(() => {
    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (!userId) {
        dispatch({ type: 'tick', now: timestamp });
        return;
      }
      if (!cloudReadyRef.current) return;
      const due = stateRef.current.reminders.filter(item => isReminderDue(item, timestamp));
      if (!due.length) return;
      for (const item of due) {
        const occurrenceKey = item.id + ':' + item.dueAt;
        if (beginningRef.current.has(occurrenceKey)) continue;
        if (!item.revision) {
          setSyncError('Reminder save is still pending. Keep this page open and retry when connected.');
          continue;
        }
        beginningRef.current.add(occurrenceKey);
        beginFocusTimerOccurrence(item.id, item.dueAt).then(result => {
          beginningRef.current.delete(occurrenceKey);
          const current = stateRef.current.reminders.find(entry => entry.id === item.id);
          if (result.reminder.status === 'ringing' && result.reminder.alertAt === item.dueAt
            && (!current || current.revision <= result.reminder.revision)) {
            dispatch({ type: 'syncReminder', reminder: result.reminder,
              events: [eventFor(item, 'triggered', Date.parse(result.reminder.updatedAt) || Date.now())] });
          } else dispatch({ type: 'syncReminder', reminder: result.reminder });
          if (!result.applied && result.reminder.status !== 'ringing' && !result.reminder.completedAt) {
            setSyncError('A reminder changed on another device. Its latest state has been restored.');
            void refreshCloud().catch(() => {});
          }
        }).catch(error => setSyncError(error.message || 'The reminder could not be marked due in the cloud.'));
      }
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
  }, [refreshCloud, userId]);
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

  useEffect(() => {
    if (!widgetOpen) return undefined;
    focusRestoreRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement : reminderToggleRef.current;
    reminderCloseRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setWidgetOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (focusRestoreRef.current?.isConnected) focusRestoreRef.current.focus();
    };
  }, [widgetOpen]);

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

  const prepareSound = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!audio.current || audio.current.state === 'closed') audio.current = new AudioContext();
      audio.current.resume().catch(() => {});
    } catch { /* Visual alerts remain available when sound is unsupported. */ }
  }, []);

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

  const addReminder = useCallback((title, duration, repeats = false, metadata = {}) => {
    prepareSound();
    const timestamp = Date.now();
    dispatch({ type: 'add', now: timestamp, item: {
      id: createReminderId(), title, dueAt: Number.isFinite(metadata?.dueAt) ? metadata.dueAt : timestamp + duration,
      status: 'waiting', repeatMs: repeats ? duration : 0, durationMs: duration,
      ...(typeof metadata?.creditAgreementId === 'string' ? { creditAgreementId: metadata.creditAgreementId } : {}),
      ...(typeof metadata?.creditInstalmentId === 'string' ? { creditInstalmentId: metadata.creditInstalmentId } : {}),
      ...(typeof metadata?.creditReminderEvent === 'string' ? { creditReminderEvent: metadata.creditReminderEvent } : {}),
      ...(typeof metadata?.paymentDueDate === 'string' ? { paymentDueDate: metadata.paymentDueDate } : {}),
    } });
  }, [prepareSound]);

  function applySharedAction(item, action) {
    const timestamp = Date.now();
    const eventItem = action === 'snooze'
      ? { ...item, dueAt: timestamp + 5 * 60_000, alertAt: undefined, status: 'waiting' } : item;
    const eventType = action === 'cancel' ? (item.repeatMs > 0 ? 'stopped' : 'cancelled')
      : action === 'dismiss' ? 'dismissed' : 'snoozed';
    const event = eventFor(eventItem, eventType, timestamp);
    if (userId && item.revision) event.expectedRevision = item.revision;
    dispatch({ type: action, id: item.id, now: timestamp, expectedRevision: item.revision });
    if (!userId || !item.revision) return;
    applyFocusTimerReminderAction(item.id, action, item.revision, event.id).then(result => {
      if (result.applied) historyKeysRef.current.add(event.id);
      dispatch({ type: 'syncReminder', reminder: result.reminder, events: result.applied ? [event] : [] });
      if (!result.applied) {
        dispatch({ type: 'removeHistoryEvent', id: event.id });
        setSyncError('This reminder changed on another device. The latest saved version is loaded; repeat your action if needed.');
      } else setSyncError('');
    }).catch(error => {
      setSyncError(error.message || 'Reminder change could not be confirmed. It remains saved on this device.');
      void refreshCloud().then(() => refreshCloud()).catch(() => {});
    });
  }

  function dismiss(id) {
    const item = stateRef.current.reminders.find(entry => entry.id === id);
    if (item) applySharedAction(item, 'dismiss');
  }
  function cancel(id) {
    const item = stateRef.current.reminders.find(entry => entry.id === id);
    if (item) applySharedAction(item, 'cancel');
  }
  function snooze(id) {
    const item = stateRef.current.reminders.find(entry => entry.id === id);
    if (!item) return;
    prepareSound();
    applySharedAction(item, 'snooze');
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
    <ReminderContext.Provider value={{ reminders, history, now, addReminder, dismiss, cancel, snooze, prepareSound, playSound, storageError, syncError, cloudReady, signedIn: Boolean(userId) }}>
      {children}
      {userId && liveTimerCount > 0 && liveDockVisible && !widgetOpen && (
        <aside aria-label="Live timers" className="ui-popover live-timer-dock fixed p-3">
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
              <button type="button" onClick={() => setLiveDockVisible(false)} aria-label="Hide live timers" title="Hide live timers" className="ui-button ui-button--sm live-timer-hide">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                  <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9 5 9 8a9.7 9.7 0 0 1-2 3.8M6.6 6.6C4.4 8 3 10.2 3 12c0 3 3.5 8 9 8 1.2 0 2.3-.2 3.3-.7" />
                </svg>
                <span>Hide</span>
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-2">
            {liveFocusSession && (
              <button type="button" onClick={() => navigateTo('/focus-timer')} className="ui-button ui-button--sm w-full justify-between text-left" aria-label={`Open ${focusIsBreak ? 'break' : 'focus'} timer for ${liveFocusSession.title}`}>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-black">{liveFocusSession.title}</span>
                  <span className="block text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                    {focusRemaining === 0 && !focusIsPaused ? `${focusIsBreak ? 'Break' : 'Focus'} finished` : `${focusIsPaused ? 'Paused ' : ''}${focusIsBreak ? 'break' : 'focus'}`}
                  </span>
                </span>
                <span role="timer" aria-live="off" className="shrink-0 font-mono text-base font-black tabular-nums sm:text-xl">{formatTimer(focusRemaining)}</span>
              </button>
            )}

            {liveReminders.slice(0, liveFocusSession ? 1 : 2).map((item) => (
              <button type="button" key={item.id} onClick={() => setWidgetOpen(true)} className={`ui-button ui-button--sm w-full justify-between text-left live-timer-item ${item.status === 'ringing' ? 'ui-button--warning' : ''}`} aria-label={`Open reminder ${item.title}`}>
                <span className="min-w-0">
                  <span className="block break-words text-sm font-black live-timer-item-title">{reminderTitle(item)}</span>
                  <span className="block text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">{item.status === 'ringing' ? 'Due now' : item.repeatMs > 0 ? 'Repeating reminder' : 'Reminder'}{reminderPaymentDueDate(item) ? ` | Payment due ${formatReminderDate(reminderPaymentDueDate(item))}` : ''}</span>
                </span>
                <span role="timer" aria-live="off" className="live-timer-item-countdown shrink-0 font-mono font-black tabular-nums">{item.status === 'ringing' ? 'Due now' : reminderCountdown(item.dueAt, now)}</span>
              </button>
            ))}

            {liveTimerCount > 2 && (
              <button type="button" onClick={() => setWidgetOpen(true)} className="text-center text-xs font-black underline decoration-2 underline-offset-2 live-timer-view-all">
                View all {liveTimerCount}
              </button>
            )}
          </div>
        </aside>
      )}
      {widgetOpen && (
        <aside id="reminder-widget" aria-label="Reminders" role="dialog" aria-labelledby="reminder-widget-title" className="ui-dialog reminder-widget fixed overflow-y-auto p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="reminder-widget-title" className="text-lg font-bold">Reminders</p>
              {ringing.length > 0 ? (
                <p role="alert" className="mt-1 text-sm font-bold">{ringing.length === 1 ? 'Your reminder is ready' : `${ringing.length} reminders are ready`}</p>
              ) : (
                <p className="mt-1 text-sm font-semibold text-[var(--color-text-secondary)]">Nothing is due right now.</p>
              )}
            </div>
            <button type="button" ref={reminderCloseRef} onClick={() => setWidgetOpen(false)} aria-label="Close reminders" className="ui-button ui-button--sm h-10 w-10 shrink-0 p-0">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {liveReminders.some(item => item.status === 'waiting') && (
            <section aria-label="Upcoming reminders" className="mt-4 border-t border-[var(--color-border)] pt-3">
              <h2 className="text-sm font-bold">Upcoming reminders</h2>
              <ul className="mt-2 grid gap-2">
                {liveReminders.filter(item => item.status === 'waiting').map(item => {
                  const paymentDueDate = reminderPaymentDueDate(item);
                  const paymentDueLabel = formatReminderDate(paymentDueDate);
                  return <li key={item.id} className="ui-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-bold">{reminderTitle(item)}</span>
                      <span className="block text-xs font-semibold text-[var(--color-text-muted)]">Alert {formatReminderAlertDate(item.dueAt)}</span>
                      {paymentDueLabel && <span className="block text-xs font-semibold text-[var(--color-text-muted)]">Payment due {paymentDueLabel}</span>}
                    </span>
                    <span role="timer" aria-live="off" aria-label={`Time remaining for ${reminderTitle(item)}`} className="live-timer-item-countdown font-mono font-black tabular-nums">{reminderCountdown(item.dueAt, now)}</span>
                  </li>;
                })}
              </ul>
            </section>
          )}
          {ringing.map((item) => (
            <div key={item.id} className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="break-words text-lg font-bold">{reminderTitle(item)}</p>
              {reminderPaymentDueDate(item) && <p className="mt-1 text-sm font-semibold">Payment due {formatReminderDate(reminderPaymentDueDate(item))}</p>}
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
      {route !== '/food-diary' && (!route.startsWith('/habit-improvement') || liveTimerCount > 0 || ringing.length > 0) && <button
        type="button"
        ref={reminderToggleRef}
        className={`ui-button reminder-toggle fixed min-h-12 gap-2 px-4 py-3 font-bold ${ringing.length > 0 ? 'ui-button--warning' : 'ui-button--primary'}`}
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
      </button>}
    </ReminderContext.Provider>
  );
}
