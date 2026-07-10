import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "https://yzigpt.github.io";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

async function hashValue(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.headers.get("origin") !== allowedOrigin) {
    return json({ ok: false, error: "Origin not allowed" }, 403);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const name = clean(body.name, 80) || "Гость";
    const text = clean(body.text, 2000);
    const rating = Number(body.rating || 0);
    if (clean(body.website, 160)) return json({ ok: true });
    if (!text || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return json({ ok: false, error: "Invalid review" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuration missing" }, 503);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const forwardedFor = request.headers.get("x-forwarded-for") || "unknown";
    const clientIp = forwardedFor.split(",")[0].trim();
    const { data: isAllowed, error: rateLimitError } = await supabase.rpc("check_request_rate_limit", {
      p_key: `review:${await hashValue(clientIp)}`,
    });
    if (rateLimitError) throw rateLimitError;
    if (!isAllowed) return json({ ok: false, error: "Too many requests" }, 429);

    const { data: review, error } = await supabase
      .from("reviews")
      .insert({ name, text, rating })
      .select("id, name, text, rating, created_at, updated_at")
      .single();
    if (error) throw error;

    return json({ ok: true, review });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Could not save review" }, 500);
  }
});
