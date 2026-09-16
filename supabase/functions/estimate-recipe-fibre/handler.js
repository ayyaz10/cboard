import { geminiErrorMessage } from '../_shared/gemini.js';
import { validateFibreRequest, validateFibreResult } from './fibreParser.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export function createFibreHandler({ createClient, env, generate }) {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return json({ error: 'Sign in to estimate fibre.' }, 401);
      const db = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
      const auth = await db.auth.getUser(token);
      if (auth.error || !auth.data?.user) return json({ error: 'Sign in again to estimate fibre.' }, 401);
      const raw = await request.text();
      if (raw.length > 60000) return json({ error: 'Recipe is too large.' }, 413);
      let context;
      try { context = validateFibreRequest(JSON.parse(raw)); }
      catch (error) { return json({ error: error.message }, 400); }
      if (!env('GEMINI_API_KEY')) return json({ error: 'AI estimation is not configured.' }, 503);
      const allowance = await db.rpc('reserve_recipe_parse');
      if (allowance.error) return json({ error: 'Could not check your AI allowance. Try again later.' }, 503);
      if (!allowance.data) return json({ error: 'Daily AI limit reached. Grocery calculations and manual entry are still available.' }, 429);
      const result = await generate(context, env('GEMINI_API_KEY'));
      try { return json(validateFibreResult(result, context)); }
      catch (error) { return json({ error: error.message }, 422); }
    } catch (error) { return json({ error: geminiErrorMessage(error, 'Could not estimate fibre. Please try again later.') }, 502); }
  };
}
