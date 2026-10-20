import {createClient} from "npm:@supabase/supabase-js@2";
import {createReceiptOcrHandler} from "./handler.js";
Deno.serve(createReceiptOcrHandler({createClient,env:(key:string)=>Deno.env.get(key),fetchImpl:fetch}));
