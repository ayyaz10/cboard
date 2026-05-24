import {
  calculateFocusScore,
  focusSessionStatuses,
} from '../features/focusTimer/focusTimerHelpers';
import {
  assertSupabaseResult,
  getUserScopedClient,
  parseNullableNumber,
} from './supabaseCrud';

const focusSessionSelect = `
  id,
  user_id,
  title,
  focus_minutes,
  break_minutes,
  task_details,
  intention,
  status,
  started_at,
  focus_ended_at,
  break_started_at,
  break_ended_at,
  completed_at,
  cancelled_at,
  reflection_result,
  distraction_level,
  energy_level,
  reflection_note,
  focus_score,
  timer_phase,
  phase_started_at,
  focus_remaining_seconds,
  break_remaining_seconds,
  created_at,
  updated_at
`;

export function toFocusSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? '',
    focusMinutes: Number(row.focus_minutes) || 0,
    breakMinutes: Number(row.break_minutes) || 0,
    taskDetails: row.task_details ?? '',
    intention: row.intention ?? '',
    status: row.status ?? focusSessionStatuses.activeFocus,
    startedAt: row.started_at,
    focusEndedAt: row.focus_ended_at,
    breakStartedAt: row.break_started_at,
    breakEndedAt: row.break_ended_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    reflectionResult: row.reflection_result ?? '',
    distractionLevel: parseNullableNumber(row.distraction_level),
    energyLevel: parseNullableNumber(row.energy_level),
    reflectionNote: row.reflection_note ?? '',
    focusScore: parseNullableNumber(row.focus_score),
    timerPhase: row.timer_phase ?? 'focus',
    phaseStartedAt: row.phase_started_at,
    focusRemainingSeconds: parseNullableNumber(row.focus_remaining_seconds),
    breakRemainingSeconds: parseNullableNumber(row.break_remaining_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFocusSessionInsert(session, userId) {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    title: session.title.trim(),
    focus_minutes: Number(session.focusMinutes),
    break_minutes: Number(session.breakMinutes) || 0,
    task_details: session.taskDetails?.trim() ?? '',
    intention: session.intention?.trim() ?? '',
    status: focusSessionStatuses.activeFocus,
    started_at: now,
    timer_phase: 'focus',
    phase_started_at: now,
    focus_remaining_seconds: Number(session.focusMinutes) * 60,
    break_remaining_seconds: (Number(session.breakMinutes) || 0) * 60,
    created_at: now,
    updated_at: now,
  };
}

function toFocusSessionUpdates(updates) {
  return {
    ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
    ...(updates.focusMinutes !== undefined ? { focus_minutes: Number(updates.focusMinutes) } : {}),
    ...(updates.breakMinutes !== undefined ? { break_minutes: Number(updates.breakMinutes) } : {}),
    ...(updates.taskDetails !== undefined ? { task_details: updates.taskDetails.trim() } : {}),
    ...(updates.intention !== undefined ? { intention: updates.intention.trim() } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.startedAt !== undefined ? { started_at: updates.startedAt } : {}),
    ...(updates.focusEndedAt !== undefined ? { focus_ended_at: updates.focusEndedAt } : {}),
    ...(updates.breakStartedAt !== undefined ? { break_started_at: updates.breakStartedAt } : {}),
    ...(updates.breakEndedAt !== undefined ? { break_ended_at: updates.breakEndedAt } : {}),
    ...(updates.completedAt !== undefined ? { completed_at: updates.completedAt } : {}),
    ...(updates.cancelledAt !== undefined ? { cancelled_at: updates.cancelledAt } : {}),
    ...(updates.reflectionResult !== undefined
      ? { reflection_result: updates.reflectionResult || null }
      : {}),
    ...(updates.distractionLevel !== undefined
      ? { distraction_level: parseNullableNumber(updates.distractionLevel) }
      : {}),
    ...(updates.energyLevel !== undefined
      ? { energy_level: parseNullableNumber(updates.energyLevel) }
      : {}),
    ...(updates.reflectionNote !== undefined
      ? { reflection_note: updates.reflectionNote.trim() }
      : {}),
    ...(updates.focusScore !== undefined ? { focus_score: updates.focusScore } : {}),
    ...(updates.timerPhase !== undefined ? { timer_phase: updates.timerPhase } : {}),
    ...(updates.phaseStartedAt !== undefined ? { phase_started_at: updates.phaseStartedAt } : {}),
    ...(updates.focusRemainingSeconds !== undefined
      ? { focus_remaining_seconds: updates.focusRemainingSeconds }
      : {}),
    ...(updates.breakRemainingSeconds !== undefined
      ? { break_remaining_seconds: updates.breakRemainingSeconds }
      : {}),
    updated_at: new Date().toISOString(),
  };
}

export async function createFocusSession(session) {
  const { client, userId } = await getUserScopedClient();
  const result = await client
    .from('focus_sessions')
    .insert(toFocusSessionInsert(session, userId))
    .select(focusSessionSelect)
    .single();

  assertSupabaseResult(result);
  return toFocusSession(result.data);
}

export async function getFocusSessions() {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('focus_sessions')
    .select(focusSessionSelect)
    .order('created_at', { ascending: false });

  assertSupabaseResult(result);
  return (result.data ?? []).map(toFocusSession);
}

export async function getActiveFocusSession() {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('focus_sessions')
    .select(focusSessionSelect)
    .in('status', [
      focusSessionStatuses.activeFocus,
      focusSessionStatuses.pausedFocus,
      focusSessionStatuses.focusComplete,
      focusSessionStatuses.activeBreak,
      focusSessionStatuses.pausedBreak,
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertSupabaseResult(result);
  return result.data ? toFocusSession(result.data) : null;
}

export async function updateFocusSession(sessionId, updates) {
  const { client } = await getUserScopedClient();
  const result = await client
    .from('focus_sessions')
    .update(toFocusSessionUpdates(updates))
    .eq('id', sessionId)
    .select(focusSessionSelect)
    .single();

  assertSupabaseResult(result);
  return toFocusSession(result.data);
}

export async function cancelFocusSession(sessionId) {
  return updateFocusSession(sessionId, {
    status: focusSessionStatuses.cancelled,
    cancelledAt: new Date().toISOString(),
    phaseStartedAt: null,
  });
}

export async function completeFocusSession(sessionId, session, breakTasks = []) {
  const completedAt = new Date().toISOString();
  const focusScore = calculateFocusScore(
    { ...session, status: focusSessionStatuses.completed },
    breakTasks,
  );

  return updateFocusSession(sessionId, {
    status: focusSessionStatuses.completed,
    completedAt,
    phaseStartedAt: null,
    focusScore,
  });
}

export async function deleteFocusSession(sessionId) {
  const { client } = await getUserScopedClient();
  const result = await client.from('focus_sessions').delete().eq('id', sessionId);
  assertSupabaseResult(result);
}
