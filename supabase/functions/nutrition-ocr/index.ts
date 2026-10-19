import { createClient } from "npm:@supabase/supabase-js@2";
import { createNutritionOcrHandler } from "./handler.js";
Deno.serve(createNutritionOcrHandler({ createClient, env: (key: string) => Deno.env.get(key), fetchImpl: fetch }));
