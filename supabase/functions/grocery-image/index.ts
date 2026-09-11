import { createClient } from "npm:@supabase/supabase-js@2";
import { createGroceryImageHandler } from "./handler.js";

Deno.serve(
  createGroceryImageHandler({
    createClient,
    env: (key: string) => Deno.env.get(key),
    fetchImpl: fetch,
  }),
);
