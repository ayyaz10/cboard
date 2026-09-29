import { useEffect, useRef, useState } from "react";
import { loadGroceries, saveGroceries } from "../../services/groceryService";
import { upsertFoodCatalogItems } from '../../services/foodCatalogService';
import { groceryCatalogUpdates } from '../nutrition/savedFoods.js';
export function useGroceries() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [undo, setUndo] = useState(null);
  const mounted = useRef(true);
  const current = useRef(null),
    lock = useRef(false);
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      current.current = await loadGroceries();
      setData(current.current.state);
      setUndo(null);
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function change(transform, message = "Saved", allowUndo = true) {
    if (!mounted.current || lock.current || !current.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const before = current.current;
    try {
      const state = transform(structuredClone(before.state));
      setData(state);
      const version = await saveGroceries(state, before.version, before.userId);
      current.current = { state, version, userId: before.userId };
      setUndo(allowUndo ? before.state : null);
      setNotice(message);
      const updates = groceryCatalogUpdates(before.state, state);
      if (updates.length) {
        try {
          await upsertFoodCatalogItems(updates, before.userId);
        } catch (error) {
          setError(`Groceries saved, but the shared food library could not be updated: ${error.message}`);
        }
      }
      return true;
    } catch (e) {
      setData(before.state);
      setError(
        e.message || "Could not save. Your previous data has been restored.",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    data,
    busy,
    error,
    setError,
    notice,
    setNotice,
    reload,
    change,
    undo: undo ? () => change(() => undo, "Undone", false) : null,
  };
}
