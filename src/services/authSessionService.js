import { requireSupabase } from '../lib/supabaseClient';
import { createUserRequest } from './authUserRequest.js';

export const getAuthenticatedUserId = createUserRequest(() => requireSupabase().auth.getUser());
