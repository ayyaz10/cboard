import { createClient } from "npm:@supabase/supabase-js@2";
import { createNutritionSearchHandler } from "./handler.js";
Deno.serve(createNutritionSearchHandler({ createClient, env: (key: string) => Deno.env.get(key), fetchImpl: fetch }));
