import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char));
}

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    const name = clean(body.name, 80);
    const contactDetails = clean(body.contact_details, 160);
    const text = clean(body.text, 2000);

    if (!name || !contactDetails || !text) {
      return json({ ok: false, error: "Name, contact and message are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

    if (!supabaseUrl || !serviceRoleKey || !botToken) {
      console.error("Telegram function secrets are not configured");
      return json({ ok: false, error: "Telegram integration is not configured" }, 503);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: createdRequest, error: insertError } = await supabase
      .from("project_requests")
      .insert({ name, contact_details: contactDetails, text })
      .select("id, request_number, created_at")
      .single();

    if (insertError) throw insertError;

    const { data: chats, error: chatsError } = await supabase
      .from("telegram_admin_chats")
      .select("chat_id");

    if (chatsError) throw chatsError;

    const siteUrl = (Deno.env.get("SITE_URL") || "https://yzigpt.github.io/cautious-winner").replace(/\/$/, "");
    const sentAt = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Yekaterinburg",
    }).format(new Date(createdRequest.created_at));
    const message = [
      `<b>🆕 Новая заявка №${createdRequest.request_number} с сайта</b>`,
      "",
      `<b>👤 Клиент:</b> ${escapeHtml(name)}`,
      `<b>📞 Контакт:</b> ${escapeHtml(contactDetails)}`,
      `<b>💬 Задача:</b> ${escapeHtml(text)}`,
      "<b>🏷 Статус:</b> Новая",
      `<b>🕒 Время:</b> ${escapeHtml(sentAt)}`,
      "",
      "<i>✨ Заявка сохранена в базе.</i>",
    ].join("\n");

    const replyMarkup = {
      inline_keyboard: [
        [{ text: "👁 Подробнее", callback_data: `view:${createdRequest.id}` }],
        [{ text: "✅ Взял в работу", callback_data: `request:${createdRequest.id}:answered` }],
        [{ text: "🚫 Отклонить заявку", callback_data: `request:${createdRequest.id}:rejected` }],
        [{ text: "🌐 Открыть сайт", url: siteUrl }],
      ],
    };

    const notificationResults = await Promise.all(
      (chats || []).map(async ({ chat_id }) => {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id,
            text: message,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          }),
        });
        return response.ok;
      })
    );

    return json({
      ok: true,
      requestId: createdRequest.id,
      notificationSent: notificationResults.some(Boolean),
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Could not save request" }, 500);
  }
});
