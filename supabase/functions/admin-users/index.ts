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

async function requireAdmin(request: Request, supabase: ReturnType<typeof createClient>) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
  if (error || !data.user || !adminEmail || data.user.email?.toLowerCase() !== adminEmail) return null;
  return data.user;
}

Deno.serve(async (request) => {
  if (request.headers.get("origin") !== allowedOrigin) return json({ ok: false, error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Configuration missing" }, 503);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    if (!await requireAdmin(request, supabase)) return json({ ok: false, error: "Administrator access required" }, 403);
    const body = await request.json();

    if (body.action === "list") {
      const [{ data: userPage, error: usersError }, { data: controls, error: controlsError }, { data: ipControls, error: ipError }] = await Promise.all([
        supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
        supabase.from("account_access_controls").select("user_id, account_status, ip_hash, last_seen_at"),
        supabase.from("ip_access_controls").select("ip_hash, access_status"),
      ]);
      if (usersError || controlsError || ipError) throw usersError || controlsError || ipError;
      const controlsByUser = new Map((controls || []).map((item) => [item.user_id, item]));
      const ipStatusByHash = new Map((ipControls || []).map((item) => [item.ip_hash, item.access_status]));
      const users = (userPage.users || []).map((user) => {
        const control = controlsByUser.get(user.id);
        return {
          id: user.id,
          email: user.email || "",
          name: String(user.user_metadata?.display_name || ""),
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          email_confirmed_at: user.email_confirmed_at,
          account_status: control?.account_status || "active",
          ip_fingerprint: control?.ip_hash ? `${control.ip_hash.slice(0, 10)}...${control.ip_hash.slice(-6)}` : "No activity yet",
          ip_status: control?.ip_hash ? (ipStatusByHash.get(control.ip_hash) || "active") : "active",
        };
      });
      return json({ ok: true, users });
    }

    if (body.action === "update") {
      const userId = String(body.user_id || "");
      const accountStatus = String(body.account_status || "active");
      const ipStatus = String(body.ip_status || "active");
      if (!/^[0-9a-f-]{36}$/i.test(userId) || !["active", "frozen", "blocked"].includes(accountStatus) || !["active", "frozen", "blocked"].includes(ipStatus)) {
        return json({ ok: false, error: "Invalid access update" }, 400);
      }
      const { data: current, error: currentError } = await supabase
        .from("account_access_controls")
        .select("ip_hash")
        .eq("user_id", userId)
        .maybeSingle();
      if (currentError) throw currentError;
      const { error: accountError } = await supabase.from("account_access_controls").upsert({
        user_id: userId,
        account_status: accountStatus,
        ip_hash: current?.ip_hash || null,
        last_seen_at: new Date().toISOString(),
      });
      if (accountError) throw accountError;

      if (current?.ip_hash) {
        if (ipStatus === "active") {
          const { error } = await supabase.from("ip_access_controls").delete().eq("ip_hash", current.ip_hash);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("ip_access_controls").upsert({
            ip_hash: current.ip_hash,
            access_status: ipStatus,
          });
          if (error) throw error;
        }
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Could not manage users" }, 500);
  }
});
