import { createClient } from '@supabase/supabase-js';
import { authLock } from './authLock.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        lock: authLock,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'App configuration is missing.',
    );
  }

  return supabase;
}
