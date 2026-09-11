import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { formatReminderInterval } from './reminderHelpers';
import { readReminderState, reminderReducer } from './reminderHistoryState.js';

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
  const audio = useRef(null);
  const announced = useRef(new Set());

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

  useEffect(() => () => { audio.current?.close().catch(() => {}); }, []);

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
    const newlyDue = reminders.filter((item) => item.status === 'ringing'
      && !announced.current.has(`${item.id}:${item.alertAt ?? item.dueAt}`));
    if (!newlyDue.length) return;
    playSound();
    for (const item of newlyDue) {
      announced.current.add(`${item.id}:${item.alertAt ?? item.dueAt}`);
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
  return (
    <ReminderContext.Provider value={{ reminders, history, now, addReminder, dismiss, cancel, snooze, prepareSound, playSound, storageError }}>
      {children}
      {ringing.length > 0 && (
        <aside aria-label="Due reminders" className="fixed bottom-4 right-4 left-4 z-50 max-h-[50vh] overflow-y-auto rounded-2xl border-2 border-black bg-[#ffd166] p-5 text-black shadow-[5px_5px_0_#000] sm:left-auto sm:w-96">
          <p role="alert" className="font-bold">{ringing.length === 1 ? 'Your reminder is ready' : `${ringing.length} reminders are ready`}</p>
          {ringing.map((item) => (
            <div key={item.id} className="mt-4 border-t border-black/20 pt-3">
              <p className="break-words text-lg font-bold">{item.title}</p>
              {item.repeatMs > 0 && <p className="mt-1 text-xs font-semibold">Repeats every {formatReminderInterval(item.repeatMs)}. Dismiss keeps it running; snooze restarts the interval after 5 minutes.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => snooze(item.id)} aria-label={`Snooze ${item.title} for 5 minutes`} className="rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold">Snooze 5 min</button>
                <button type="button" onClick={() => dismiss(item.id)} aria-label={`Dismiss ${item.title}`} className="rounded-full border-2 border-black bg-black px-4 py-2 text-sm font-bold text-white">Dismiss</button>
                {item.repeatMs > 0 && <button type="button" onClick={() => cancel(item.id)} aria-label={`Stop repeating ${item.title}`} className="rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold">Stop repeating</button>}
              </div>
            </div>
          ))}
        </aside>
      )}
    </ReminderContext.Provider>
  );
}
