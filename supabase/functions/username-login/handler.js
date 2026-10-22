const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" },
  });
}

const invalidLogin = () => json(401, { error: "Invalid login credentials." });

function clientIp(request) {
  const value = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || request.headers.get("cf-connecting-ip")?.trim()
    || "";
  if (!value || value.length > 45 || /[^0-9a-fA-F:.]/.test(value)) return "";
  if (value.includes(":")) {
    try { new URL(`http://[${value}]`); return value; }
    catch { return ""; }
  }
  const octets = value.split(".");
  return octets.length === 4 && octets.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
    ? value
    : "";
}

export function createUsernameLoginHandler({ createClient, env, fetchImpl = fetch }) {
  return async request => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return json(405, { error: "Method not allowed." });

    let body;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json(400, { error: "Invalid request." });
      const chunks = [];
      let byteLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > 2048) {
          await reader.cancel();
          return json(400, { error: "Invalid request." });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return json(400, { error: "Invalid request." }); }
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 1 || password.length > 1024) {
      return invalidLogin();
    }

    const url = env("SUPABASE_URL");
    let secretKey = "";
    try { secretKey = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}").default || ""; }
    catch { return json(503, { error: "Sign-in is temporarily unavailable." }); }
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const forwardedFor = clientIp(request);
    if (!url || !secretKey || !serviceRoleKey || !forwardedFor) return json(503, { error: "Sign-in is temporarily unavailable." });

    let email = `unknown-${username}@invalid.local`;
    try {
      const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await admin.from("profiles").select("email").eq("username", username).maybeSingle();
      if (error) return json(503, { error: "Sign-in is temporarily unavailable." });
      if (typeof data?.email === "string" && data.email.includes("@")) email = data.email;
    } catch {
      return json(503, { error: "Sign-in is temporarily unavailable." });
    }

    try {
      const authResponse = await fetchImpl(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: secretKey, "sb-forwarded-for": forwardedFor, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10000),
      });
      if (authResponse.status === 400 || authResponse.status === 401 || authResponse.status === 422) return invalidLogin();
      if (!authResponse.ok) return json(503, { error: "Sign-in is temporarily unavailable." });

      const session = await authResponse.json();
      if (typeof session?.access_token !== "string" || typeof session?.refresh_token !== "string") {
        return json(503, { error: "Sign-in is temporarily unavailable." });
      }
      return json(200, { access_token: session.access_token, refresh_token: session.refresh_token });
    } catch {
      return json(503, { error: "Sign-in is temporarily unavailable." });
    }
  };
}
