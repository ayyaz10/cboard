import { createClient } from "npm:@supabase/supabase-js@2";
import { createFinanceHandler } from "./handler.js";
import { financeInstruction } from "./financeParser.js";
async function generate(context: unknown, key: string) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ system_instruction: { parts: [{ text: financeInstruction }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error("Gemini unavailable");
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.filter((p: any) => typeof p.text === "string" && !p.thought).map((p: any) => p.text).join("");
  return JSON.parse(text);
}
Deno.serve(createFinanceHandler({ createClient, env: (key: string) => Deno.env.get(key), generate }));
