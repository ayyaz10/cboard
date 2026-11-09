const markerFor = requestId => `[habit-run:${requestId}]`;

export function createHabitFocusLaunch({ requestId, userId, node, habitTitle, date, minimumMode = false, returnTo = '/habit-improvement' }) {
  if (!requestId || !userId || !node?.id || !node.actionContract) throw new Error('Habit Focus Timer launch details are incomplete.');
  const contract = node.actionContract;
  return {
    requestId,
    userId,
    nodeId: node.id,
    habitId: node.habitId,
    habitTitle: habitTitle || 'Habit',
    action: contract.action,
    minimum: contract.minimum,
    date,
    minimumMode: Boolean(minimumMode),
    focusMinutes: minimumMode ? contract.minimumFocusMinutes : contract.focusMinutes,
    returnTo,
  };
}

export function getHabitFocusMarker(launch) {
  return launch?.requestId ? markerFor(launch.requestId) : '';
}

export function findLinkedHabitFocusSession(sessions, launch) {
  const marker = getHabitFocusMarker(launch);
  return marker ? (sessions || []).find(session => session.intention?.includes(marker)) || null : null;
}

export function hasHabitFocusSessionConflict(activeSession, linkedSession) {
  return Boolean(activeSession && activeSession.id !== linkedSession?.id);
}

export function createHabitFocusReturn(launch, status, focusSessionId, endedAt = new Date().toISOString()) {
  if (!launch?.requestId || !['COMPLETED', 'CANCELLED'].includes(status)) throw new Error('Habit Focus Timer return details are invalid.');
  return { ...launch, status, focusSessionId: focusSessionId || launch.focusSessionId || null, endedAt };
}
