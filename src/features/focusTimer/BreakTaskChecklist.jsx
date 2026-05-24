export function BreakTaskChecklist({ tasks, onToggleTask }) {
  if (!tasks.length) {
    return (
      <div className="rounded-[1.35rem] border-2 border-black bg-white px-4 py-5 text-sm font-bold leading-6 text-black/70">
        No break tasks saved for this session.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {tasks.map((task) => (
        <label
          key={task.id}
          className="flex items-center gap-3 rounded-[1.2rem] border-2 border-black bg-white px-3 py-3"
        >
          <input
            type="checkbox"
            checked={task.isCompleted}
            onChange={(event) => onToggleTask(task, event.target.checked)}
            className="h-5 w-5 accent-[#c5ff6f]"
          />
          <span className="text-sm font-bold text-black">{task.taskText}</span>
        </label>
      ))}
    </div>
  );
}
