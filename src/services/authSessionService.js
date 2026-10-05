import { requireSupabase } from '../lib/supabaseClient.js';
import { createUserRequest } from './authUserRequest.js';

export const getAuthenticatedUserId = createUserRequest(() => requireSupabase().auth.getUser());
