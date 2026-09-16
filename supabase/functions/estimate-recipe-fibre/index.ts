import { createClient } from 'npm:@supabase/supabase-js@2';
import { geminiJson, geminiResult } from '../_shared/gemini.js';
import { createFibreHandler } from './handler.js';
import { fibreInstruction } from './fibreParser.js';
async function generate(context: unknown, key: string) {
  return geminiResult(await geminiJson('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ system_instruction: { parts: [{ text: fibreInstruction }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(context) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
  }));
}
Deno.serve(createFibreHandler({ createClient, env: (key: string) => Deno.env.get(key), generate }));
