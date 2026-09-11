import { createClient } from "npm:@supabase/supabase-js@2";
import { createParseRecipeHandler } from "./handler.js";
import { recipeSystemInstruction } from "./recipeParser.js";

class GeminiHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`Gemini request failed with status ${status}`);
    this.name = "GeminiHttpError";
    this.status = status;
  }
}

async function generateRecipe(recipeText: string, apiKey: string): Promise<unknown> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: recipeSystemInstruction }] },
      contents: [{ role: "user", parts: [{ text: `UNTRUSTED_RECIPE_DATA_START\n${recipeText}\nUNTRUSTED_RECIPE_DATA_END` }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!response.ok) throw new GeminiHttpError(response.status);
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Empty model response");
  return JSON.parse(text);
}

Deno.serve(createParseRecipeHandler({
  createClient,
  env: (key: string) => Deno.env.get(key),
  generateRecipe,
}));
