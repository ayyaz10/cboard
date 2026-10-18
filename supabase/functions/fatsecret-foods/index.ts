import { createClient } from "npm:@supabase/supabase-js@2";
import { createFatSecretHandler } from "./handler.js";

Deno.serve(createFatSecretHandler({ createClient, env: (key: string) => Deno.env.get(key), fetchImpl: fetch }));
