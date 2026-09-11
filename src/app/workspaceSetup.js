// Reuse the migration while giving every effect run its own completion handler.
// React Strict Mode cleans up and replays effects during development.
export function observeWorkspaceSetup(setupRef, userId, migrate, onSuccess, onError) {
  if (setupRef.current?.userId !== userId) {
    setupRef.current = { userId, promise: Promise.resolve().then(migrate) };
  }

  let active = true;
  setupRef.current.promise.then(
    () => { if (active) onSuccess(); },
    (error) => { if (active) onError(error); },
  );

  return () => { active = false; };
}
