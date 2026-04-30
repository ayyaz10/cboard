import { requireSupabase } from '../lib/supabaseClient';

export async function getAuthenticatedUserId() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error('You must be logged in to access this data.');
  }

  return data.user.id;
}
