import { GoogleGenAI } from "npm:@google/genai@1.20.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createParseRecipeHandler } from "./handler.js";
import { geminiResponseSchema, recipeSystemInstruction } from "./recipeParser.js";

async function generateRecipe(recipeText: string, apiKey: string): Promise<unknown> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `UNTRUSTED_RECIPE_DATA_START\n${recipeText}\nUNTRUSTED_RECIPE_DATA_END`,
    config: {
      systemInstruction: recipeSystemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseJsonSchema: geminiResponseSchema,
    },
  });
  if (typeof response.text !== "string" || !response.text.trim()) throw new Error("Empty model response");
  return JSON.parse(response.text);
}

Deno.serve(createParseRecipeHandler({
  createClient,
  env: (key: string) => Deno.env.get(key),
  generateRecipe,
}));
