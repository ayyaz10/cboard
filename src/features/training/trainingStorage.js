import { validateState } from "./trainingData.js";
export function equivalentData(a, b) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export const cacheKey = (userId) => `cboard:training:v1:${userId}`;
export function readCache(storage, userId) {
  const raw = storage.getItem(cacheKey(userId));
  if (!raw) return null;
  const cache = JSON.parse(raw);
  validateState(cache.data);
  if (
    !Number.isInteger(cache.revision) ||
    cache.revision < 0 ||
    typeof cache.dirty !== "boolean"
  )
    throw new Error(
      "Invalid Training cache. Export or recover the stored data before proceeding.",
    );
  return cache;
}
export function writeCache(storage, userId, cache) {
  validateState(cache.data);
  storage.setItem(cacheKey(userId), JSON.stringify(cache));
}
