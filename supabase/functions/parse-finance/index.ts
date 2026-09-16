import { geminiJson, geminiResult } from "../_shared/gemini.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createFinanceHandler } from "./handler.js";
import { financeInstruction } from "./financeParser.js";
async function generate(context: unknown, key: string) {
  const response = await geminiJson("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ system_instruction: { parts: [{ text: financeInstruction }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  return geminiResult(response);
}
Deno.serve(createFinanceHandler({ createClient, env: (key: string) => Deno.env.get(key), generate }));
