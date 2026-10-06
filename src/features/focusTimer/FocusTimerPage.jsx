import { useEffect, useMemo, useState } from 'react';
import { AppNavigation } from '../../components/layout/AppNavigation';
import { PageShell } from '../../components/layout/PageShell';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import {
  createBreakTask,
  getBreakTasksBySession,
  getBreakTasksForSessions,
  updateBreakTask,
} from '../../services/focusBreakTaskService';
import {
  cancelFocusSession,
  completeFocusSession,
  createFocusSession,
  deleteFocusSession,
  getActiveFocusSession,
  getFocusSessions,
  updateFocusSession,
} from '../../services/focusSessionService';
import { BreakTaskChecklist } from './BreakTaskChecklist';
import { FocusHistory } from './FocusHistory';
import { FocusSessionForm } from './FocusSessionForm';
import { FocusStats } from './FocusStats';
import { ReflectionModal } from './ReflectionModal';
import { RemindersPanel } from './RemindersPanel';
import {
  calculateFocusScore,
  focusSessionStatuses,
  formatTimer,
  getPhaseRemainingSeconds,
} from './focusTimerHelpers';

function playAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.85);
  } catch {
    // Alarm sound is best-effort because browsers can block audio without user activation.
  }
}

function notifyUser(title, body) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

function FocusCompleteModal({ isOpen, session, onStartBreak, onSkipBreak, onFinishSession, onClose }) {
  if (!isOpen || !session) {
    return null;
  }

  return (
    <div
      className="ui-overlay fixed inset-0 z-40 flex items-center justify-center px-4 py-6"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-complete-title"
        className="ui-dialog w-full max-w-lg p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3"><span className="ui-eyebrow">Focus complete</span><button type="button" aria-label="Close popup" onClick={onClose} className="ui-button ui-button--sm h-9 w-9 p-0 text-xl leading-none">×</button></div>
        <h2
          id="focus-complete-title"
          className="mt-5 text-3xl font-bold tracking-[-0.05em] text-[var(--color-text)]"
        >
          Focus session complete
        </h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-[var(--color-text-secondary)]">
          {session.title} is ready to close out or move into a break.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={onStartBreak}
            disabled={session.breakMinutes <= 0}
            className="ui-button ui-button--primary ui-button--sm uppercase tracking-[0.12em]"
          >
            Start Break
          </button>
          <button
            type="button"
            onClick={onSkipBreak}
            className="ui-button ui-button--sm uppercase tracking-[0.12em]"
          >
            Skip Break
          </button>
          <button
            type="button"
            onClick={onFinishSession}
            className="ui-button ui-button--sm uppercase tracking-[0.12em]"
          >
            Finish Session
          </button>
        </div>
      </section>
    </div>
  );
}

function ActiveTimer({
  session,
  breakTasks,
  remainingSeconds,
  onPause,
  onResume,
  onCancel,
  onCompleteFocus,
  onCompleteBreak,
  onSkipBreak,
  onToggleBreakTask,
}) {
  const isBreak = [
    focusSessionStatuses.activeBreak,
    focusSessionStatuses.pausedBreak,
  ].includes(session.status);
  const isPaused = [
    focusSessionStatuses.pausedFocus,
    focusSessionStatuses.pausedBreak,
  ].includes(session.status);
  const taskCount = breakTasks.filter((task) => task.isCompleted).length;

  return (
    <section className="ui-panel focus-active-session p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            {isBreak ? 'Break mode' : 'Focus mode'}
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">
            {session.title}
          </h2>
        </div>
        <span className="ui-badge ui-badge--accent text-xs uppercase tracking-[0.14em]">
          {isPaused ? 'Paused' : 'Running'}
        </span>
      </div>

      <p className="mt-6 text-7xl font-bold tracking-[-0.05em] sm:text-8xl">
        {formatTimer(remainingSeconds)}
      </p>

      {session.intention && !isBreak ? (
        <p className="ui-card mt-4 px-4 py-3 text-sm font-semibold leading-6">
          {session.intention}
        </p>
      ) : null}

      {isBreak ? (
        <div className="ui-card mt-5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Break checklist
            </p>
            <span className="ui-badge text-xs uppercase tracking-[0.12em]">
              {taskCount}/{breakTasks.length}
            </span>
          </div>
          <BreakTaskChecklist tasks={breakTasks} onToggleTask={onToggleBreakTask} />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {isPaused ? (
          <button
            type="button"
            onClick={onResume}
            className="ui-button ui-button--primary uppercase tracking-[0.12em]"
          >
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            className="ui-button uppercase tracking-[0.12em]"
          >
            Pause
          </button>
        )}
        {!isBreak ? (
          <button
            type="button"
            onClick={onCompleteFocus}
            className="ui-button ui-button--primary uppercase tracking-[0.12em]"
          >
            Complete focus
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onCompleteBreak}
              className="ui-button ui-button--primary uppercase tracking-[0.12em]"
            >
              Complete break
            </button>
            <button
              type="button"
              onClick={onSkipBreak}
              className="ui-button uppercase tracking-[0.12em]"
            >
              Skip break
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="ui-button ui-button--danger uppercase tracking-[0.12em]"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

function activeSessionSort(session) {
  return [
    focusSessionStatuses.activeFocus,
    focusSessionStatuses.pausedFocus,
    focusSessionStatuses.focusComplete,
    focusSessionStatuses.activeBreak,
    focusSessionStatuses.pausedBreak,
  ].includes(session.status);
}

export function FocusTimerPage() {
  const { confirm, dialog } = useConfirmDialog();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [breakTasksBySessionId, setBreakTasksBySessionId] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReflectionSaving, setIsReflectionSaving] = useState(false);
  const [error, setError] = useState('');
  const [showFocusCompleteModal, setShowFocusCompleteModal] = useState(false);
  const [reflectionSession, setReflectionSession] = useState(null);
  const [openSessionId, setOpenSessionId] = useState('');
  const activeBreakTasks = activeSession
    ? breakTasksBySessionId[activeSession.id] || []
    : [];

  const sortedSessions = useMemo(
    () => [...sessions].sort((left, right) => {
      const leftActive = activeSessionSort(left);
      const rightActive = activeSessionSort(right);

      if (leftActive !== rightActive) {
        return leftActive ? -1 : 1;
      }

      return (right.createdAt || '').localeCompare(left.createdAt || '');
    }),
    [sessions],
  );

  async function loadFocusData() {
    setError('');

    try {
      const [savedSessions, savedActiveSession] = await Promise.all([
        getFocusSessions(),
        getActiveFocusSession(),
      ]);
      const taskMap = await getBreakTasksForSessions(savedSessions.map((session) => session.id));

      setSessions(savedSessions);
      setActiveSession(savedActiveSession);
      setBreakTasksBySessionId(taskMap);
      if (savedActiveSession?.status === focusSessionStatuses.focusComplete) {
        setShowFocusCompleteModal(true);
      }
    } catch (loadError) {
      setError('Could not load focus sessions. Apply the Supabase focus schema and refresh.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadFocusData();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    window.dispatchEvent(new CustomEvent('cboard:focus-session-changed', {
      detail: { session: activeSession },
    }));
  }, [activeSession, isLoading]);

  useEffect(() => {
    if (!activeSession) {
      setRemainingSeconds(0);
      return undefined;
    }

    const syncRemaining = () => {
      setRemainingSeconds(getPhaseRemainingSeconds(activeSession));
    };

    syncRemaining();
    const timerId = window.setInterval(syncRemaining, 1000);

    return () => window.clearInterval(timerId);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession || remainingSeconds > 0) {
      return;
    }

    const timestampRemainingSeconds = getPhaseRemainingSeconds(activeSession);

    if (timestampRemainingSeconds > 0) {
      return;
    }

    if (activeSession.status === focusSessionStatuses.activeFocus) {
      handleCompleteFocus(true);
    }

    if (activeSession.status === focusSessionStatuses.activeBreak) {
      handleCompleteBreak(true);
    }
  }, [activeSession, remainingSeconds]);

  function mergeSession(session) {
    setSessions((current) => [
      session,
      ...current.filter((currentSession) => currentSession.id !== session.id),
    ]);
  }

  async function refreshSessionTasks(sessionId) {
    const tasks = await getBreakTasksBySession(sessionId);
    setBreakTasksBySessionId((current) => ({ ...current, [sessionId]: tasks }));
    return tasks;
  }

  async function handleCreateSession(sessionForm) {
    setIsSaving(true);
    setError('');

    try {
      const session = await createFocusSession(sessionForm);
      const tasks = await Promise.all(
        sessionForm.breakTasks.map((taskText, index) =>
          createBreakTask({
            sessionId: session.id,
            taskText,
            sortOrder: index,
          }),
        ),
      );

      mergeSession(session);
      setActiveSession(session);
      setBreakTasksBySessionId((current) => ({ ...current, [session.id]: tasks }));
      setShowFocusCompleteModal(false);
      notifyUser('Focus session started', session.title);
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePause() {
    if (!activeSession) {
      return;
    }

    const isBreak = activeSession.status === focusSessionStatuses.activeBreak;
    const nextSession = await updateFocusSession(activeSession.id, {
      status: isBreak ? focusSessionStatuses.pausedBreak : focusSessionStatuses.pausedFocus,
      phaseStartedAt: null,
      ...(isBreak
        ? { breakRemainingSeconds: remainingSeconds }
        : { focusRemainingSeconds: remainingSeconds }),
    });

    setActiveSession(nextSession);
    mergeSession(nextSession);
  }

  async function handleResume() {
    if (!activeSession) {
      return;
    }

    const isBreak = activeSession.status === focusSessionStatuses.pausedBreak;
    const now = new Date().toISOString();
    const nextSession = await updateFocusSession(activeSession.id, {
      status: isBreak ? focusSessionStatuses.activeBreak : focusSessionStatuses.activeFocus,
      phaseStartedAt: now,
      timerPhase: isBreak ? 'break' : 'focus',
    });

    setActiveSession(nextSession);
    mergeSession(nextSession);
  }

  async function handleCancel() {
    if (!activeSession) {
      return;
    }

    const confirmed = await confirm({
      title: 'Cancel focus session?',
      message: `This will stop "${activeSession.title}" and mark it cancelled.`,
      confirmLabel: 'Cancel session',
    });

    if (!confirmed) {
      return;
    }

    const nextSession = await cancelFocusSession(activeSession.id);
    setActiveSession(null);
    mergeSession(nextSession);
    setShowFocusCompleteModal(false);
  }

  async function handleCompleteFocus(fromTimer = false) {
    if (!activeSession || activeSession.status === focusSessionStatuses.focusComplete) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = await updateFocusSession(activeSession.id, {
      status: focusSessionStatuses.focusComplete,
      focusEndedAt: now,
      phaseStartedAt: null,
      focusRemainingSeconds: 0,
    });

    playAlarm();
    notifyUser('Focus session complete', fromTimer ? 'Your focus timer ended.' : activeSession.title);
    setActiveSession(nextSession);
    mergeSession(nextSession);
    setShowFocusCompleteModal(true);
  }

  async function handleStartBreak() {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const nextSession = await updateFocusSession(activeSession.id, {
      status: focusSessionStatuses.activeBreak,
      timerPhase: 'break',
      breakStartedAt: now,
      phaseStartedAt: now,
      breakRemainingSeconds: activeSession.breakMinutes * 60,
    });

    setActiveSession(nextSession);
    mergeSession(nextSession);
    setShowFocusCompleteModal(false);
  }

  async function handleSkipBreak() {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const score = calculateFocusScore(
      { ...activeSession, status: focusSessionStatuses.skippedBreak },
      activeBreakTasks,
    );
    const nextSession = await updateFocusSession(activeSession.id, {
      status: focusSessionStatuses.skippedBreak,
      completedAt: now,
      phaseStartedAt: null,
      breakRemainingSeconds: 0,
      focusScore: score,
    });

    setActiveSession(null);
    mergeSession(nextSession);
    setShowFocusCompleteModal(false);
    setReflectionSession(nextSession);
  }

  async function handleFinishSession() {
    if (!activeSession) {
      return;
    }

    const nextSession = await completeFocusSession(
      activeSession.id,
      activeSession,
      activeBreakTasks,
    );

    setActiveSession(null);
    mergeSession(nextSession);
    setShowFocusCompleteModal(false);
    setReflectionSession(nextSession);
  }

  async function handleCompleteBreak(fromTimer = false) {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const score = calculateFocusScore(
      { ...activeSession, status: focusSessionStatuses.completed },
      activeBreakTasks,
    );
    const nextSession = await updateFocusSession(activeSession.id, {
      status: focusSessionStatuses.completed,
      breakEndedAt: now,
      completedAt: now,
      phaseStartedAt: null,
      breakRemainingSeconds: 0,
      focusScore: score,
    });

    playAlarm();
    notifyUser('Break complete', fromTimer ? 'Your break timer ended.' : activeSession.title);
    setActiveSession(null);
    mergeSession(nextSession);
    setReflectionSession(nextSession);
  }

  async function handleToggleBreakTask(task, isCompleted) {
    const nextTask = await updateBreakTask(task.id, { isCompleted });
    setBreakTasksBySessionId((current) => ({
      ...current,
      [task.sessionId]: (current[task.sessionId] || []).map((item) =>
        item.id === nextTask.id ? nextTask : item,
      ),
    }));
  }

  async function handleSaveReflection(reflection) {
    const session = reflectionSession;

    if (!session) {
      return;
    }

    setIsReflectionSaving(true);

    try {
      const tasks = breakTasksBySessionId[session.id] || [];
      const score = calculateFocusScore({ ...session, ...reflection }, tasks);
      const nextSession = await updateFocusSession(session.id, {
        ...reflection,
        focusScore: score,
      });

      mergeSession(nextSession);
      setReflectionSession(null);
    } finally {
      setIsReflectionSaving(false);
    }
  }

  async function handleDeleteSession(session) {
    const confirmed = await confirm({
      title: 'Delete focus session?',
      message: `This removes "${session.title}" and its break checklist.`,
      confirmLabel: 'Delete',
    });

    if (!confirmed) {
      return;
    }

    await deleteFocusSession(session.id);
    setSessions((current) => current.filter((currentSession) => currentSession.id !== session.id));
    setBreakTasksBySessionId((current) => {
      const { [session.id]: _removed, ...rest } = current;
      return rest;
    });
    if (activeSession?.id === session.id) {
      setActiveSession(null);
    }
  }

  function handleToggleOpen(sessionId) {
    setOpenSessionId((current) => (current === sessionId ? '' : sessionId));
  }

  return (
    <PageShell>
      <section className="ui-panel p-6 sm:p-8 lg:p-10">
        <AppNavigation activePath="/focus-timer" />

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <span className="pill">Focus sessions</span>
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-[-0.05em] text-[var(--color-text)] sm:text-5xl lg:text-6xl">
          Focus Timer
        </h1>

        <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-[var(--color-text-secondary)] sm:text-lg">
          Make time to focus, take a break, and set reminders for the things you don’t want to forget.
        </p>

        <RemindersPanel />

        {error ? (
          <p className="ui-badge ui-badge--danger mt-5 block rounded-[var(--radius-md)] px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className="ui-card mt-8 p-6 text-lg font-bold">
            Loading focus sessions...
          </div>
        ) : (
          <div className="mt-8 grid items-start gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="grid gap-5">
              {activeSession ? (
                <ActiveTimer
                  session={activeSession}
                  breakTasks={activeBreakTasks}
                  remainingSeconds={remainingSeconds}
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  onCompleteFocus={() => handleCompleteFocus(false)}
                  onCompleteBreak={() => handleCompleteBreak(false)}
                  onSkipBreak={handleSkipBreak}
                  onToggleBreakTask={handleToggleBreakTask}
                />
              ) : (
                <FocusSessionForm
                  onCreateSession={handleCreateSession}
                  isSaving={isSaving}
                />
              )}
              <FocusStats
                sessions={sessions}
                breakTasksBySessionId={breakTasksBySessionId}
              />
            </div>

            <FocusHistory
              sessions={sortedSessions}
              breakTasksBySessionId={breakTasksBySessionId}
              openSessionId={openSessionId}
              onToggleOpen={handleToggleOpen}
              onEditReflection={setReflectionSession}
              onDeleteSession={handleDeleteSession}
            />
          </div>
        )}
      </section>

      <FocusCompleteModal
        isOpen={showFocusCompleteModal}
        session={activeSession}
        onStartBreak={handleStartBreak}
        onSkipBreak={handleSkipBreak}
        onFinishSession={handleFinishSession}
        onClose={() => setShowFocusCompleteModal(false)}
      />
      <ReflectionModal
        isOpen={Boolean(reflectionSession)}
        session={reflectionSession}
        onSaveReflection={handleSaveReflection}
        onClose={() => setReflectionSession(null)}
        isSaving={isReflectionSaving}
      />
      <ConfirmDialog isOpen={Boolean(dialog)} {...dialog} />
    </PageShell>
  );
}
