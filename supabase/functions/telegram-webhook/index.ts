import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function telegramUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegramRequest(token: string, method: string, body: unknown) {
  const response = await fetch(telegramUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) console.error(`Telegram ${method} failed: ${response.status}`);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (webhookSecret && request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await request.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!supabaseUrl || !serviceRoleKey || !botToken) return new Response("Configuration missing", { status: 503 });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const message = update.message;
    if (message?.chat && String(message.text || "").startsWith("/start")) {
      const chat = message.chat;
      await supabase.from("telegram_admin_chats").upsert({
        chat_id: chat.id,
        chat_type: chat.type,
        display_name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Admin",
      });

      await telegramRequest(botToken, "sendMessage", {
        chat_id: chat.id,
        text: "<b>✨ Frog Oxide: бот подключён</b>\n\nНовые заявки с сайта будут приходить сюда сразу после отправки.\n\nНажмите кнопку в уведомлении, чтобы отметить заявку как взятую в работу.",
        parse_mode: "HTML",
      });
    }

    const callback = update.callback_query;
    const match = String(callback?.data || "").match(/^request:([0-9a-f-]{36}):(answered|new|rejected)$/i);
    if (callback && match) {
      const [, requestId, status] = match;
      await supabase
        .from("project_requests")
        .update({
          status,
          admin_reply:
            status === "answered"
              ? "Взято в работу через Telegram"
              : status === "rejected"
                ? "Отклонено через Telegram"
                : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text:
          status === "answered"
            ? "Заявка отмечена как взятая в работу ✅"
            : status === "rejected"
              ? "Заявка отклонена 🚫"
              : "Статус обновлён",
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("ok", { status: 200 });
  }
});
