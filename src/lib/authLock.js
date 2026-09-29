import { processLock } from '@supabase/supabase-js';

const unavailable = () => Object.assign(new Error('Your session is busy in another tab. Please try again shortly.'), { isAcquireTimeout: true });

// Keep cross-tab token refresh exclusive. Never steal a lock: its previous
// callback would keep running and could overwrite a newer session.
export function createAuthLock(getManager = () => globalThis.navigator?.locks) {
  return async (name, timeout, callback) => {
    const manager = getManager();
    if (!manager) return processLock(name, timeout, callback);
    const controller = new AbortController();
    let timer;
    const options = timeout === 0
      ? { mode: 'exclusive', ifAvailable: true }
      : { mode: 'exclusive', signal: controller.signal };
    if (timeout > 0) timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await manager.request(name, options, async lock => {
        clearTimeout(timer);
        if (!lock) throw unavailable();
        return callback();
      });
    } catch (error) {
      if (controller.signal.aborted) throw unavailable();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

const browserLock = createAuthLock();
// supabase-js does not forward lockAcquireTimeout to its auth client in this
// version, so apply the mobile-friendly wait here. Keep refresh's zero-wait mode.
export const authLock = (name, timeout, callback) => browserLock(name, timeout > 0 ? 30000 : timeout, callback);
