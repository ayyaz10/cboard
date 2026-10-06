export function BreakTaskChecklist({ tasks, onToggleTask }) {
  if (!tasks.length) {
    return (
      <div className="ui-card px-4 py-5 text-sm font-bold leading-6">
        No break tasks saved for this session.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {tasks.map((task) => (
        <label
          key={task.id}
          className="ui-card flex items-center gap-3 px-3 py-3"
        >
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={(event) => onToggleTask(task, event.target.checked)}
            className="h-5 w-5"
          />
          <span className="text-sm font-bold text-[var(--color-text)]">{task.taskText}</span>
        </label>
      ))}
    </div>
  );
}
