const isLockError = error => error?.isAcquireTimeout === true || /lock.*(steal|stole|broken)/i.test(error?.message || '');

// Share only the in-flight verification, never cache a user's identity.
export function createUserRequest(getUser) {
  let pending;
  return () => {
    if (!pending) {
      pending = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const result = await getUser();
            if (result.error) throw result.error;
            if (!result.data.user?.id) throw new Error('You must be logged in to access this data.');
            return result.data.user.id;
          } catch (error) {
            // Only retry the read-only identity check, not database writes.
            if (attempt || !isLockError(error)) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      })().finally(() => { pending = undefined; });
    }
    return pending;
  };
}
