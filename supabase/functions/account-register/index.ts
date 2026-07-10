import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "https://yzigpt.github.io";
const siteUrl = (Deno.env.get("SITE_URL") || "https://yzigpt.github.io/cautious-winner").replace(/\/$/, "");
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

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
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
    const body = await request.json();
    const name = clean(body.name, 80);
    const email = clean(body.email, 160).toLowerCase();
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) {
      return json({ ok: false, error: "Enter a name and valid email" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuration missing" }, 503);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const ipHash = await hashIp(clientIp(request));

    const { data: ipControl, error: ipError } = await supabase
      .from("ip_access_controls")
      .select("access_status")
      .eq("ip_hash", ipHash)
      .maybeSingle();
    if (ipError) throw ipError;
    if (ipControl) return json({ ok: false, error: "Registration is unavailable from this network" }, 403);

    const { data: rateAllowed, error: rateError } = await supabase.rpc("check_request_rate_limit", {
      p_key: `signup:${ipHash}`,
    });
    if (rateError) throw rateError;
    if (!rateAllowed) return json({ ok: false, error: "Please wait before trying again" }, 429);

    const { data: invite, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { display_name: name },
      redirectTo: `${siteUrl}/set-password.html`,
    });
    if (inviteError || !invite.user) {
      return json({ ok: false, error: "Could not create the account invitation" }, 400);
    }

    const { error: accessError } = await supabase.from("account_access_controls").upsert({
      user_id: invite.user.id,
      account_status: "active",
      ip_hash: ipHash,
      last_seen_at: new Date().toISOString(),
    });
    if (accessError) throw accessError;

    return json({ ok: true, message: "Check your email to confirm the account and set a password." });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Could not start registration" }, 500);
  }
});
