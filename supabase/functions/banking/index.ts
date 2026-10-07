import { createClient } from 'npm:@supabase/supabase-js@2';
import { createBankingHandler } from './handler.js';

Deno.serve(createBankingHandler({ createClient, env: (key: string) => Deno.env.get(key), fetchImpl: fetch }));
