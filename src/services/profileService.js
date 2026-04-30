import { requireSupabase } from '../lib/supabaseClient';

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(normalizeUsername(username));
}

export async function resolveLoginEmail(identifier) {
  const client = requireSupabase();
  const trimmedIdentifier = identifier.trim();

  if (trimmedIdentifier.includes('@')) {
    return trimmedIdentifier;
  }

  const { data, error } = await client.rpc('resolve_login_email', {
    login_identifier: normalizeUsername(trimmedIdentifier),
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('No account found for that username.');
  }

  return data;
}
