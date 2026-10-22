import { createClient } from "npm:@supabase/supabase-js@2";
import { createUsernameLoginHandler } from "./handler.js";

Deno.serve(createUsernameLoginHandler({
  createClient,
  env: (key: string) => Deno.env.get(key),
  fetchImpl: fetch,
}));
