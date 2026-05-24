import {
  calculateFocusScore,
  formatSessionDate,
  getSessionBreakTaskSummary,
} from './focusTimerHelpers';

function formatResult(result) {
  if (!result) {
    return 'Not reflected';
  }

  return result === 'yes'
    ? 'Completed'
    : result === 'partially'
    ? 'Partially'
    : 'No';
}

function notePreview(note) {
  if (!note) {
    return 'No note yet';
  }

  return note.length > 96 ? `${note.slice(0, 96)}...` : note;
}

export function FocusHistoryItem({
  session,
  breakTasks,
  isOpen,
  onToggleOpen,
  onEditReflection,
  onDeleteSession,
}) {
  const taskSummary = getSessionBreakTaskSummary(breakTasks);
  const score = Number.isFinite(session.focusScore)
    ? Math.round(session.focusScore)
    : calculateFocusScore(session, breakTasks);

  return (
    <article className="rounded-[1.35rem] border-2 border-black bg-[#fffdf8] p-4">
      <button
        type="button"
        onClick={onToggleOpen}
        className="w-full text-left"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/55">
              {formatSessionDate(session.startedAt || session.createdAt)}
            </p>
            <h3 className="mt-2 text-xl font-bold tracking-[-0.04em] text-black">
              {session.title}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-black/65">
              {notePreview(session.reflectionNote)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border-2 border-black bg-[#c5ff6f] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
              {session.status}
            </span>
            <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-black">
              {score} score
            </span>
          </div>
        </div>
      </button>

      {isOpen ? (
        <div className="mt-4 border-t-2 border-black/15 pt-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[1rem] border-2 border-black bg-white p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                Duration
              </p>
              <p className="mt-2 text-sm font-bold text-black">
                {session.focusMinutes} min focus / {session.breakMinutes} min break
              </p>
            </div>
            <div className="rounded-[1rem] border-2 border-black bg-white p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                Intention result
              </p>
              <p className="mt-2 text-sm font-bold text-black">
                {formatResult(session.reflectionResult)}
              </p>
            </div>
            <div className="rounded-[1rem] border-2 border-black bg-white p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/55">
                Distraction
              </p>
              <p className="mt-2 text-sm font-bold text-black">
                {Number.isFinite(session.distractionLevel) ? session.distractionLevel : '--'}
              </p>
            </div>
          </div>

          {session.intention ? (
            <p className="mt-3 rounded-[1rem] border-2 border-black bg-white px-3 py-2 text-sm font-semibold leading-6 text-black/70">
              <strong className="text-black">Intention:</strong> {session.intention}
            </p>
          ) : null}

          {session.taskDetails ? (
            <p className="mt-3 rounded-[1rem] border-2 border-black bg-white px-3 py-2 text-sm font-semibold leading-6 text-black/70">
              <strong className="text-black">Notebook:</strong> {session.taskDetails}
            </p>
          ) : null}

          <div className="mt-3 rounded-[1rem] border-2 border-black bg-white px-3 py-2 text-sm font-semibold leading-6 text-black/70">
            Break tasks: {taskSummary.completed}/{taskSummary.total}
          </div>

          {session.reflectionNote ? (
            <p className="mt-3 rounded-[1rem] border-2 border-black bg-white px-3 py-2 text-sm font-semibold leading-6 text-black/70">
              {session.reflectionNote}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onEditReflection}
              className="rounded-full border-2 border-black bg-[#9fe3ff] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[3px_3px_0_#000]"
            >
              Edit note
            </button>
            <button
              type="button"
              onClick={onDeleteSession}
              className="rounded-full border-2 border-black bg-[#ffe0de] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[3px_3px_0_#000]"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function FocusHistory({
  sessions,
  breakTasksBySessionId,
  openSessionId,
  onToggleOpen,
  onEditReflection,
  onDeleteSession,
}) {
  return (
    <section className="rounded-[1.75rem] border-2 border-black bg-[#9fe3ff] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/55">
            History
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.04em] text-black">
            Focus sessions
          </h2>
        </div>
        <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Details collapsed
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="mt-5 rounded-[1.35rem] border-2 border-black bg-white px-4 py-5 text-sm font-bold leading-6 text-black/70">
          No focus sessions yet. Start your first focus session.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {sessions.map((session) => (
            <FocusHistoryItem
              key={session.id}
              session={session}
              breakTasks={breakTasksBySessionId[session.id] || []}
              isOpen={openSessionId === session.id}
              onToggleOpen={() => onToggleOpen(session.id)}
              onEditReflection={() => onEditReflection(session)}
              onDeleteSession={() => onDeleteSession(session)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
