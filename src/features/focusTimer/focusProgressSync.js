export function shouldSyncFocusSessionToGoal(goal) {
  const type = `${goal?.type || ''} ${goal?.goalType || ''} ${goal?.title || ''}`.toLowerCase();
  return type.includes('pomodoro') || type.includes('focus');
}

export async function syncCompletedFocusSessionToProgressTracker() {
  // Placeholder for a later Progress Tracker integration.
  // Keep this no-op until focus sessions can be matched to a specific tracker goal.
  return false;
}
