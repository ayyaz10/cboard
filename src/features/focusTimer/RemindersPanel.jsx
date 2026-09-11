import { useEffect, useRef, useState } from 'react';
import { useReminders } from './ReminderProvider';
import { ReminderHistory } from './ReminderHistory.jsx';
import { ReminderPresets } from './ReminderPresets.jsx';
import { durationMilliseconds, formatReminderInterval, reminderCountdown } from './reminderHelpers';

const presets = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1 hr 30 min']];
const buttonClass = 'rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-bold text-black hover:bg-[#c5ff6f]';
const inputClass = 'mt-2 w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-base font-semibold text-black';

export function RemindersPanel() {
  const { reminders, now, addReminder, cancel, prepareSound, playSound, storageError } = useReminders();
  const [repeats, setRepeats] = useState(false);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('30');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const titleInput = useRef(null);
  const duration = durationMilliseconds(hours, minutes);
  const upcoming = reminders.filter((item) => item.status === 'waiting' || item.repeatMs > 0).sort((a, b) => a.dueAt - b.dueAt);

  useEffect(() => {
    const mode = window.location.hash;
    if (mode !== '#reminders-once' && mode !== '#reminders-repeat') return;
    setRepeats(mode === '#reminders-repeat');
    window.requestAnimationFrame(() => document.getElementById('reminders-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  function submit(event) {
    event.preventDefault();
    if (!title.trim() || !duration) {
      setError('Add a title and choose a duration of at least 1 minute.');
      return;
    }
    addReminder(title.trim(), duration, repeats);
    setMessage(`Reminder set: ${title.trim()}${repeats ? `, every ${formatReminderInterval(duration)}` : ''}.`);
    setError('');
    setTitle('');
  }

  async function enableNotifications() {
    try {
      const permission = await Notification.requestPermission();
      setNotificationMessage(permission === 'granted' ? 'Browser notifications are on.'
        : permission === 'denied' ? 'Notifications are blocked. You can enable them in your browser’s site settings.'
          : 'Notifications were not enabled. On-screen reminders will still appear.');
    } catch { setNotificationMessage('Browser notifications are unavailable. On-screen reminders will still appear.'); }
  }

  return (
    <section aria-labelledby="reminders-heading" className="mt-8 rounded-[1.75rem] border-2 border-black bg-[#fffdf8] p-5 text-black shadow-[6px_6px_0_#000] sm:p-6">
      <span className="pill">A little nudge</span>
      <h2 id="reminders-heading" className="mt-4 text-3xl font-bold tracking-[-0.05em]">Reminders</h2>
      <p className="mt-2 text-sm font-medium text-black/70">Give it a name, choose how long, and carry on. No focus session needed.</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="grid content-start gap-4">
          <label className="text-sm font-bold">Remind me to
            <input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required placeholder="e.g. Check the oven or call Alex" className={inputClass} />
          </label>
          <fieldset>
            <legend className="text-sm font-bold">How often?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" aria-pressed={!repeats} onClick={() => setRepeats(false)} className={`${buttonClass} ${!repeats ? '!bg-[#c5ff6f]' : ''}`}>Just once</button>
              <button type="button" aria-pressed={repeats} onClick={() => setRepeats(true)} className={`${buttonClass} ${repeats ? '!bg-[#c5ff6f]' : ''}`}>Repeat</button>
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-bold">{repeats ? 'Remind me every' : 'Remind me after'}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {presets.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={duration === value * 60_000} onClick={() => { setHours(String(Math.floor(value / 60))); setMinutes(String(value % 60)); }} className={`${buttonClass} ${duration === value * 60_000 ? '!bg-[#c5ff6f]' : ''}`}>{label}</button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">Hours<input type="number" min="0" max="168" step="1" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} className={inputClass} /></label>
              <label className="text-sm font-bold">Minutes<input type="number" min="0" max="59" step="1" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} className={inputClass} /></label>
            </div>
          </fieldset>
          {repeats && duration > 0 && <p className="text-sm text-black/70">First alert in {formatReminderInterval(duration)}, then every {formatReminderInterval(duration)} until you stop it.</p>}
          {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
          <button type="submit" className="rounded-full border-2 border-black bg-[#c5ff6f] px-5 py-3 text-sm font-bold shadow-[4px_4px_0_#000]">{repeats ? 'Start repeating reminder' : 'Set reminder'}</button>
          <p role="status" className="text-sm font-semibold">{message}</p>
        </form>
        <div>
          <h3 className="font-bold">Upcoming{upcoming.length > 0 ? ` (${upcoming.length})` : ''}</h3>
          {upcoming.length === 0 ? <p className="mt-3 rounded-xl border-2 border-dashed border-black/20 p-5 text-sm text-black/60">Your reminders will appear here with a live countdown.</p> : (
            <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto p-1">
              {upcoming.map((item) => (
                <li key={item.id} className="rounded-xl border-2 border-black bg-white p-4">
                  <p className="break-words font-bold">{item.title}</p>
                  {item.repeatMs > 0 && <p className="mt-1 text-xs font-bold text-black/70">Every {formatReminderInterval(item.repeatMs)}</p>}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p role="timer" aria-label={`Time remaining for ${item.title}`} className="text-2xl font-bold tabular-nums">{reminderCountdown(item.dueAt, now)}</p>
                      <p className="text-xs text-black/60">Due {new Date(item.dueAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                    </div>
                    <button type="button" onClick={() => cancel(item.id)} aria-label={`${item.repeatMs > 0 ? 'Stop repeating' : 'Cancel'} ${item.title}`} className={buttonClass}>{item.repeatMs > 0 ? 'Stop repeating' : 'Cancel'}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ReminderPresets title={title} duration={duration} repeats={repeats} onEdit={(preset) => {
        setTitle(preset.title);
        setHours(String(Math.floor(preset.duration / 3_600_000)));
        setMinutes(String((preset.duration / 60_000) % 60));
        setRepeats(preset.repeats);
        setError('');
        setMessage('');
        titleInput.current?.focus();
      }} />
      <ReminderHistory />
      <div className="mt-5 border-t border-black/15 pt-4">
        <p className="text-xs font-medium leading-5 text-black/60">Saved for your account on this browser. Keep the app open for alerts; sleeping devices or suspended tabs may delay them. After a refresh, use Test sound to enable audio again.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { prepareSound(); window.setTimeout(playSound, 150); }} className={buttonClass}>Test sound</button>
          {'Notification' in window && <button type="button" onClick={enableNotifications} className={buttonClass}>Enable notifications</button>}
        </div>
        <p role="status" className="mt-2 text-xs font-semibold">{notificationMessage}</p>
        {storageError && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{storageError}</p>}
      </div>
    </section>
  );
}
