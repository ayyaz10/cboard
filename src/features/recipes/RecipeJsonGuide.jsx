import { useRef, useState } from 'react';
import prompt from './recipe-conversion-prompt.txt?raw';

export function RecipeJsonGuide() {
  const text = useRef(null);
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('Prompt copied. Paste it into ChatGPT, then add your recipe at the bottom.');
    } catch {
      text.current?.focus();
      text.current?.select();
      setNotice('Automatic copying is unavailable. The prompt is selected below; use Copy or Ctrl/Cmd+C.');
    }
  }
  return <details className="rounded-2xl border-2 border-black bg-[#f4f9e9] p-5">
    <summary className="cursor-pointer text-lg font-bold">Convert a recipe with ChatGPT — copy the prompt</summary>
    <div className="mt-4 space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
        <li>Copy the prompt below and open <a className="font-bold underline" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPT (new tab)</a>.</li>
        <li>Paste the prompt into a chat. Replace the placeholder at the bottom with your recipe, including ingredients, steps, servings and any nutrition values. Send it and answer any clarification questions.</li>
        <li>Copy the JSON ChatGPT returns. Paste it into <strong>Paste Recipe JSON</strong> below, without any surrounding explanation or code fences.</li>
        <li>Select <strong>Preview Recipe</strong>, check the ingredients, portions and nutrition, optionally add a photo, then save.</li>
      </ol>
      <p className="text-sm leading-6">The prompt requests calories, protein, carbs, fat and fibre for every ingredient’s listed quantity, plus recipe totals. Estimates must be labeled in the notes; unresolved values stay blank. Check the quantities, sources and per-serving or whole-recipe basis before saving: the planner’s 1× uses the listed recipe values.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={copy} className="rounded-full border-2 border-black bg-[#c5ff6f] px-4 py-2 font-bold">Copy ChatGPT prompt</button>
        <a download="cboard-recipe-prompt.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(prompt)}`} className="rounded-full border-2 border-black bg-white px-4 py-2 font-bold">Download prompt</a>
      </div>
      <label htmlFor="recipe-chatgpt-prompt" className="block text-sm font-bold">Reusable conversion prompt</label>
      <textarea ref={text} id="recipe-chatgpt-prompt" className="field-input min-h-64 font-mono text-sm" readOnly value={prompt} spellCheck={false} />
      <p role="status" className="text-sm">{notice}</p>
      <p className="text-sm text-black/70">This copies instructions only. Your recipe is sent to ChatGPT only when you paste and send it there. This JSON workflow does not run the app’s AI ingredient review.</p>
    </div>
  </details>;
}
