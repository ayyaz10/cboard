import { assertSupabaseResult, getUserScopedClient } from './supabaseCrud';

const breakTaskSelect = `
  id,
  session_id,
  user_id,
  task_text,
  is_completed,
  sort_order,
  created_at
`;

export function toBreakTask(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    taskText: row.task_text ?? '',
    isCompleted: Boolean(row.is_completed),
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    createdAt: row.created_at,
  };
}

function toBreakTaskPayload(task, userId) {
  return {
    user_id: userId,
    session_id: task.sessionId ?? task.session_id,
    task_text: task.taskText?.trim() ?? task.task_text?.trim() ?? '',
    is_completed: Boolean(task.isCompleted ?? task.is_completed),
    sort_order: Number.isFinite(task.sortOrder ?? task.sort_order)
      ? task.sortOrder ?? task.sort_order
      : 0,
  };
}

export async function createBreakTask(task) {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from('focus_break_tasks')
    .insert(toBreakTaskPayload(task, userId))
    .select(breakTaskSelect)
    .single();

  assertSupabaseResult(result);
  return toBreakTask(result.data);
}

export async function getBreakTasksBySession(sessionId) {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('focus_break_tasks')
    .select(breakTaskSelect)
    .eq('session_id', sessionId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  assertSupabaseResult(result);
  return (result.data ?? []).map(toBreakTask);
}

export async function getBreakTasksForSessions(sessionIds) {
  if (!sessionIds.length) {
    return {};
  }

  const { client } = await getUserScopedClient();
  const result = await client
    .from('focus_break_tasks')
    .select(breakTaskSelect)
    .in('session_id', sessionIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  assertSupabaseResult(result);

  return (result.data ?? []).reduce((tasksBySession, row) => {
    const task = toBreakTask(row);
    tasksBySession[task.sessionId] = [...(tasksBySession[task.sessionId] || []), task];
    return tasksBySession;
  }, {});
}

export async function updateBreakTask(taskId, updates) {
  const { client } = await getUserScopedClient();
  const payload = {
    ...(updates.taskText !== undefined ? { task_text: updates.taskText.trim() } : {}),
    ...(updates.isCompleted !== undefined ? { is_completed: Boolean(updates.isCompleted) } : {}),
    ...(updates.sortOrder !== undefined ? { sort_order: updates.sortOrder } : {}),
  };
  const result = await client
    .from('focus_break_tasks')
    .update(payload)
    .eq('id', taskId)
    .select(breakTaskSelect)
    .single();

  assertSupabaseResult(result);
  return toBreakTask(result.data);
}

export async function deleteBreakTask(taskId) {
  const { client } = await getUserScopedClient();
  const result = await client.from('focus_break_tasks').delete().eq('id', taskId);
  assertSupabaseResult(result);
}

export async function reorderBreakTasks(tasks) {
  const { client } = await getUserScopedClient();

  for (const task of tasks) {
    const result = await client
      .from('focus_break_tasks')
      .update({ sort_order: task.sortOrder })
      .eq('id', task.id);
    assertSupabaseResult(result);
  }
}
