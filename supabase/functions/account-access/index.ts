import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "https://yzigpt.github.io";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
}

async function hashIp(ip: string) {
  const salt = Deno.env.get("IP_ACCESS_SALT");
  if (!salt) throw new Error("IP access protection is not configured");
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.headers.get("origin") !== allowedOrigin) return json({ ok: false, error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuration missing" }, 503);
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Authentication required" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userResult, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userResult.user) return json({ ok: false, error: "Authentication required" }, 401);
    const ipHash = await hashIp(clientIp(request));
    const [{ data: accountControl, error: accountError }, { data: ipControl, error: ipError }] = await Promise.all([
      supabase.from("account_access_controls").select("account_status").eq("user_id", userResult.user.id).maybeSingle(),
      supabase.from("ip_access_controls").select("access_status").eq("ip_hash", ipHash).maybeSingle(),
    ]);
    if (accountError || ipError) throw accountError || ipError;
    const status = accountControl?.account_status || "active";
    if (status !== "active" || ipControl) {
      return json({ ok: false, status: ipControl?.access_status || status, error: "Access to this account is restricted" }, 403);
    }

    const { error: upsertError } = await supabase.from("account_access_controls").upsert({
      user_id: userResult.user.id,
      account_status: "active",
      ip_hash: ipHash,
      last_seen_at: new Date().toISOString(),
    });
    if (upsertError) throw upsertError;
    return json({ ok: true, status: "active" });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Could not verify account access" }, 500);
  }
});
