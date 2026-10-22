// Coalesce concurrent work by key without retaining values or sharing mutable results.
export function createSingleFlightByKey() {
  const pending = new Map();

  return function singleFlight(key, operation) {
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key);
        });
      pending.set(key, request);
    }
    return request.then(value => structuredClone(value));
  };
}
