export const FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const CACHE_PREFIX = "flux-1-schnell:colorful-icon:v2:";
export const GENERATION_TIMEOUT_MS = 45000;

export function cloudflareConfig(env) {
  const accountId = env("CLOUDFLARE_ACCOUNT_ID")?.trim();
  const apiToken = env("CLOUDFLARE_API_TOKEN")?.trim();
  // Conservative reservation, not a price quote. Includes free-tier requests.
  const reserveUsd = Number(env("CLOUDFLARE_IMAGE_RESERVE_USD") ?? "0.01");
  const monthlyCapUsd = Number(env("CLOUDFLARE_MONTHLY_USER_CAP_USD") ?? "1");
  if (
    !accountId ||
    !/^[a-f0-9]{32}$/i.test(accountId) ||
    !apiToken ||
    !Number.isFinite(reserveUsd) ||
    reserveUsd <= 0 ||
    !Number.isFinite(monthlyCapUsd) ||
    monthlyCapUsd <= 0
  ) {
    throw new Error(
      "Cloudflare photos are not configured yet. Upload a photo for now.",
    );
  }
  return { accountId, apiToken, reserveUsd, monthlyCapUsd };
}

export async function generateFluxPhoto(name, config, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${FLUX_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `Colorful illustrated grocery icon of ${name}. Friendly modern vector-style illustration, bold cheerful colors, simple clean shapes, subtle soft shading, centered single grocery item, isolated on a warm cream background, consistent app icon style, square composition, highly recognizable, no text, no letters, no label, no logo, no branding, no border, no photorealism.`,
          steps: 4,
        }),
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      },
    );
  } catch {
    throw new Error(
      "Cloudflare did not finish in time. Retry to create a new image using your remaining allowance, or upload a photo.",
    );
  }
  if (response.status === 429)
    throw new Error(
      "Cloudflare's image limit was reached. Try later or upload a photo.",
    );
  if (response.status === 401 || response.status === 403)
    throw new Error(
      "Cloudflare could not authorize image generation. Check the Account ID and Workers AI token permissions.",
    );
  if (!response.ok)
    throw new Error(
      "Cloudflare could not generate this photo. Retry later or upload a photo.",
    );
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "Cloudflare returned an unreadable image response. Please retry.",
    );
  }
  if (payload.success !== true || payload.errors?.length)
    throw new Error(
      "Cloudflare could not generate this photo. Check Workers AI usage or retry later.",
    );
  const base64 = payload.result?.image;
  if (
    typeof base64 !== "string" ||
    base64.length > 8 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw new Error(
      "Cloudflare returned an invalid image. Please retry or upload a photo.",
    );
  let bytes;
  try {
    bytes = atob(base64);
  } catch {
    throw new Error(
      "Cloudflare returned an invalid image. Please retry or upload a photo.",
    );
  }
  if (
    bytes.length < 5 ||
    bytes.charCodeAt(0) !== 255 ||
    bytes.charCodeAt(1) !== 216 ||
    bytes.charCodeAt(2) !== 255 ||
    bytes.charCodeAt(bytes.length - 2) !== 255 ||
    bytes.charCodeAt(bytes.length - 1) !== 217
  )
    throw new Error(
      "Cloudflare did not return a JPEG photo. Please retry or upload a photo.",
    );
  return `data:image/jpeg;base64,${base64}`;
}
