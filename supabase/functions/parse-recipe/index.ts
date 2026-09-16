import { geminiJson, geminiResult, GeminiError } from "../_shared/gemini.js";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createParseRecipeHandler } from "./handler.js";
import { recipeSystemInstruction } from "./recipeParser.js";


async function generateRecipe(recipeText: string, apiKey: string): Promise<unknown> {
  const modelsResponse = await geminiJson("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
  }, { timeoutMs: 5000 });

  const modelsPayload = modelsResponse;
  const availableModels = (Array.isArray(modelsPayload?.models) ? modelsPayload.models : [])
    .filter((model: { name?: unknown; supportedGenerationMethods?: unknown }) => typeof model?.name === "string"
      && Array.isArray(model.supportedGenerationMethods)
      && model.supportedGenerationMethods.includes("generateContent"))
    .map((model: { name: string }) => model.name.replace(/^models\//, ""));
  const preferredModels = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
  const model = preferredModels.find((name) => availableModels.includes(name))
    || availableModels.find((name: string) => /^gemini-.*flash/i.test(name));
  if (!model) throw new GeminiError(404);

  const response = await geminiJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
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
  return geminiResult(response);
}

Deno.serve(createParseRecipeHandler({
  createClient,
  env: (key: string) => Deno.env.get(key),
  generateRecipe,
}));
