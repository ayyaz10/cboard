// Retry only provider reads/generation, never application writes or quota reservations.
export class GeminiError extends Error {
  constructor(status = 0, kind = "http") {
    super(`Gemini ${kind} failure (${status})`);
    this.name = "GeminiError";
    this.status = status;
    this.kind = kind;
  }
}

export async function geminiJson(url, options, { fetchImpl = fetch, timeoutMs = 25000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let failure;
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        // Do not retain provider bodies: they may contain submitted data.
        await response.body?.cancel();
        throw new GeminiError(response.status);
      }
      return await response.json();
    } catch (error) {
      failure = error instanceof GeminiError ? error
        : new GeminiError(0, controller.signal.aborted ? "timeout" : error instanceof SyntaxError ? "invalid" : "network");
    } finally {
      clearTimeout(timer);
    }
    const retryable = [500, 502, 503, 504].includes(failure.status) || ["timeout", "network"].includes(failure.kind);
    // Quota errors are surfaced immediately; repeated calls won't fix an exhausted free allowance.
    if (attempt || !retryable) throw failure;
    await wait(750 + Math.floor(Math.random() * 250));
  }
}

export function geminiResult(payload) {
  const candidate = payload?.candidates?.[0];
  if (payload?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== "STOP"))
    throw new GeminiError(0, "incomplete");
  const text = candidate?.content?.parts?.filter((part) => typeof part.text === "string" && !part.thought).map((part) => part.text).join("");
  if (!text?.trim()) throw new GeminiError(0, "empty");
  try { return JSON.parse(text); }
  catch { throw new GeminiError(0, "invalid"); }
}

export function geminiErrorMessage(error, fallback) {
  if (!(error instanceof GeminiError)) return fallback;
  if (error.status === 429) return "Gemini's rate or usage limit has been reached. Please try again later. Manual entry is still available.";
  if ([401, 403].includes(error.status)) return "Gemini rejected the API key. Check its permissions and configuration.";
  if (error.status === 404) return "The configured Gemini model is unavailable. Please check the AI configuration.";
  if (error.status === 400) return "Gemini could not accept this request. Please check the input or AI configuration.";
  if (error.kind === "timeout" || error.status === 504) return "Gemini took too long to respond, even after retrying. Please try again shortly.";
  if (["empty", "invalid", "incomplete"].includes(error.kind)) return "Gemini returned an incomplete response. Please try again or use manual entry.";
  return "Gemini is temporarily unavailable, even after retrying. Please try again shortly or use manual entry.";
}
