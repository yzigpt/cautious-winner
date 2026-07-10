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

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char));
}

function statusLabel(status: string) {
  if (status === "answered") return "✅ Принята";
  if (status === "rejected") return "🚫 Отклонена";
  return "🆕 Новая";
}

type ProjectRequest = {
  id: string;
  name: string;
  text: string;
  status: string;
  created_at: string;
};

function requestMenu() {
  return {
    inline_keyboard: [
      [{ text: "📋 Все заявки", callback_data: "list:all" }],
      [
        { text: "🆕 Новые", callback_data: "list:new" },
        { text: "✅ Принятые", callback_data: "list:answered" },
      ],
      [{ text: "🚫 Отклонённые", callback_data: "list:rejected" }],
    ],
  };
}

function requestActions(requestId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Взять в работу", callback_data: `request:${requestId}:answered` },
        { text: "🚫 Отклонить", callback_data: `request:${requestId}:rejected` },
      ],
      [{ text: "📋 К списку заявок", callback_data: "list:all" }],
    ],
  };
}

async function sendRequestList(
  supabase: any,
  botToken: string,
  chatId: number,
  filter: "all" | "new" | "answered" | "rejected"
) {
  let query = supabase
    .from("project_requests")
    .select("id, name, text, status, created_at")
    .order("created_at", { ascending: false })
    .limit(12);

  if (filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  if (error) throw error;
  const requests = (data || []) as ProjectRequest[];

  const heading =
    filter === "all"
      ? "📋 <b>Все заявки</b>"
      : filter === "answered"
        ? "✅ <b>Принятые заявки</b>"
        : filter === "rejected"
          ? "🚫 <b>Отклонённые заявки</b>"
          : "🆕 <b>Новые заявки</b>";

  const rows = requests.map((item, index) => {
    const createdAt = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Yekaterinburg",
    }).format(new Date(item.created_at));
    const text = escapeHtml(String(item.text || "").slice(0, 260));
    return [
      `<b>${index + 1}. ${escapeHtml(item.name)}</b>`,
      `💬 ${text}`,
      `🏷 <b>Статус:</b> ${statusLabel(item.status)}`,
      `🕒 ${createdAt}`,
    ].join("\n");
  });

  const message = rows.length
    ? `${heading}\n\n${rows.join("\n\n────────────\n\n")}`
    : `${heading}\n\nПока здесь нет заявок.`;

  const detailButtons = requests.map((item, index) => [
    {
      text: `👁 Подробнее: ${index + 1}. ${item.name.slice(0, 28)}`,
      callback_data: `view:${item.id}`,
    },
  ]);

  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [...detailButtons, ...requestMenu().inline_keyboard],
    },
  });
}

async function sendRequestDetails(
  supabase: any,
  botToken: string,
  chatId: number,
  requestId: string
) {
  const { data, error } = await supabase
    .from("project_requests")
    .select("id, name, text, status, admin_reply, created_at, updated_at")
    .eq("id", requestId)
    .single();

  if (error || !data) throw error || new Error("Request not found");

  const createdAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Yekaterinburg",
  }).format(new Date(data.created_at));
  const updatedAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Yekaterinburg",
  }).format(new Date(data.updated_at || data.created_at));
  const message = [
    "<b>👁 Просмотр заявки</b>",
    "",
    `<b>👤 Клиент:</b> ${escapeHtml(data.name)}`,
    `<b>💬 Сообщение:</b>\n${escapeHtml(data.text)}`,
    `<b>🏷 Статус:</b> ${statusLabel(data.status)}`,
    `<b>🕒 Получена:</b> ${createdAt}`,
    `<b>🔄 Обновлена:</b> ${updatedAt}`,
  ];

  if (data.admin_reply) message.push(`<b>📝 Отметка:</b> ${escapeHtml(data.admin_reply)}`);

  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: message.join("\n"),
    parse_mode: "HTML",
    reply_markup: requestActions(data.id),
  });
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
    if (message?.chat && (String(message.text || "").startsWith("/start") || ["/requests", "/заявки"].includes(String(message.text || "").toLowerCase()))) {
      const chat = message.chat;
      await supabase.from("telegram_admin_chats").upsert({
        chat_id: chat.id,
        chat_type: chat.type,
        display_name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Admin",
      });

      await telegramRequest(botToken, "sendMessage", {
        chat_id: chat.id,
        text: "<b>✨ Frog Oxide: бот подключён</b>\n\nНовые заявки с сайта будут приходить сюда сразу после отправки.\n\nВыберите, какие заявки посмотреть, или нажмите кнопку в уведомлении, чтобы изменить её статус.",
        parse_mode: "HTML",
        reply_markup: requestMenu(),
      });
    }

    const callback = update.callback_query;
    const listMatch = String(callback?.data || "").match(/^list:(all|new|answered|rejected)$/i);
    if (callback && listMatch) {
      const filter = listMatch[1].toLowerCase() as "all" | "new" | "answered" | "rejected";
      await sendRequestList(supabase, botToken, callback.message.chat.id, filter);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Список заявок обновлён",
      });
      return new Response("ok", { status: 200 });
    }

    const viewMatch = String(callback?.data || "").match(/^view:([0-9a-f-]{36})$/i);
    if (callback && viewMatch) {
      await sendRequestDetails(supabase, botToken, callback.message.chat.id, viewMatch[1]);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Заявка открыта",
      });
      return new Response("ok", { status: 200 });
    }

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
