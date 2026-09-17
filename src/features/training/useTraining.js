import { useCallback, useEffect, useRef, useState } from "react";
import { loadTraining, saveTraining } from "../../services/trainingService";
import { seedState } from "./seed";
import { readCache, writeCache, equivalentData } from "./trainingStorage";
import { validateState } from "./trainingData";
export function useTraining(userId) {
  const [data, setData] = useState(null),
    [status, setStatus] = useState("Loading Training…"),
    [error, setError] = useState("");
  const current = useRef(null),
    busy = useRef(false),
    alive = useRef(true),
    undoRef = useRef(null);
  const sync = useCallback(async () => {
    if (busy.current || !current.current?.dirty) return;
    busy.current = true;
    try {
      while (alive.current && current.current?.dirty) {
        const sent = current.current;
        if (!equivalentData(readCache(localStorage, userId), sent))
          throw new Error(
            "Training changed in another tab. Refresh before syncing.",
          );
        setStatus("Saving to cloud…");
        const revision = await saveTraining(userId, sent.data, sent.revision);
        if (!alive.current) return;
        if (!equivalentData(readCache(localStorage, userId), current.current))
          throw new Error(
            "Training changed in another tab. Its pending data is preserved; refresh to reconcile with the cloud.",
          );
        const next = {
          ...current.current,
          revision,
          dirty: current.current !== sent,
        };
        writeCache(localStorage, userId, next);
        current.current = next;
      }
      if (alive.current) {
        setStatus("Saved to cloud · available offline");
        setError("");
      }
    } catch (err) {
      if (alive.current) {
        setError(err.message || "Cloud save failed.");
        setStatus("Saved on this device · cloud sync pending");
      }
    } finally {
      busy.current = false;
    }
  }, [userId]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      let cached;
      try {
        cached = readCache(localStorage, userId);
        if (cached) {
          setStatus("Checking your saved Training data…");
        }
      } catch (err) {
        setError(err.message);
        setStatus("Stored data needs recovery");
        return;
      }
      try {
        const remote = await loadTraining(userId);
        if (cancelled || !alive.current) return;
        cached = readCache(localStorage, userId);
        if (
          cached &&
          !cached.dirty &&
          cached.revision > (remote?.revision || 0)
        ) {
          current.current = cached;
          setData(cached.data);
          setStatus("Saved on this device · refresh to recheck cloud");
          return;
        }
        if (cached?.dirty) {
          if (remote && equivalentData(remote.data, cached.data))
            cached = { ...cached, revision: remote.revision, dirty: false };
          current.current = cached;
          setData(cached.data);
          writeCache(localStorage, userId, cached);
          if ((remote?.revision || 0) !== cached.revision)
            throw new Error(
              "Conflict: Training changed on another device. Export this device’s backup, then load the cloud copy.",
            );
          if (cached.dirty) await sync();
          else setStatus("Saved to cloud · available offline");
        } else {
          const next = {
            data: validateState(remote?.data || seedState()),
            revision: remote?.revision || 0,
            dirty: !remote,
          };
          writeCache(localStorage, userId, next);
          current.current = next;
          setData(next.data);
          setStatus("Saved to cloud · available offline");
          if (next.dirty) await sync();
        }
      } catch (err) {
        if (cancelled || !alive.current) return;
        if (cached) {
          current.current = cached;
          setData(cached.data);
        }
        setError(err.message || "Could not load Training.");
        setStatus(
          cached
            ? "Saved on this device · cloud unavailable"
            : "Cloud unavailable. Retry to safely load your Training data.",
        );
      }
    })();
    const online = () => sync();
    window.addEventListener("online", online);
    const timer = setInterval(sync, 30000);
    return () => {
      cancelled = true;
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [userId, sync]);
  function change(fn, { undo = true } = {}) {
    try {
      if (!current.current) throw new Error("Wait for Training to load.");
      // Detect other tabs before writing. Never silently replace their newer work.
      const stored = readCache(localStorage, userId);
      if (stored && JSON.stringify(stored) !== JSON.stringify(current.current))
        throw new Error(
          "Training changed in another tab. Refresh before editing.",
        );
      const nextData = validateState(
        typeof fn === "function"
          ? fn(structuredClone(current.current.data))
          : fn,
      );
      const next = { ...current.current, data: nextData, dirty: true };
      writeCache(localStorage, userId, next);
      if (undo) undoRef.current = current.current.data;
      current.current = next;
      setData(nextData);
      setStatus("Saved on this device · cloud sync pending");
      setError("");
      void sync();
      return true;
    } catch (err) {
      setError(`Not saved: ${err.message}`);
      return false;
    }
  }
  return {
    data,
    status,
    error,
    change,
    retry: () => (current.current?.dirty ? sync() : window.location.reload()),
    undo: () => {
      if (undoRef.current) {
        const previous = undoRef.current;
        if (change(previous, { undo: false })) undoRef.current = null;
      }
    },
    canUndo: !!undoRef.current,
    loadCloud: async () => {
      if (busy.current) {
        setError("Wait for the current cloud save to finish.");
        return;
      }
      try {
        const remote = await loadTraining(userId);
        if (!remote) throw new Error("No cloud copy exists.");
        const next = {
          data: validateState(remote.data),
          revision: remote.revision,
          dirty: false,
        };
        writeCache(localStorage, userId, next);
        current.current = next;
        undoRef.current = null;
        setData(next.data);
        setError("");
        setStatus("Cloud copy loaded");
      } catch (err) {
        setError(err.message);
      }
    },
  };
}
