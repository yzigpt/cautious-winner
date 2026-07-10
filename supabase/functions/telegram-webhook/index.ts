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
  request_number: number;
  name: string;
  contact_details: string;
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
      [{ text: "⭐ Управление отзывами", callback_data: "reviews:list" }],
    ],
  };
}

function reviewMenu() {
  return {
    inline_keyboard: [
      [{ text: "🔄 Обновить отзывы", callback_data: "reviews:list" }],
      [{ text: "📋 К заявкам", callback_data: "list:all" }],
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
      [{ text: "🗑 Удалить заявку", callback_data: `delete:${requestId}` }],
      [{ text: "📋 К списку заявок", callback_data: "list:all" }],
    ],
  };
}

function deleteConfirmation(requestId: string) {
  return {
    inline_keyboard: [
      [{ text: "🗑 Да, удалить навсегда", callback_data: `delete-confirm:${requestId}` }],
      [{ text: "↩️ Отмена", callback_data: `view:${requestId}` }],
    ],
  };
}

function reviewDeleteConfirmation(reviewId: string) {
  return {
    inline_keyboard: [
      [{ text: "🗑 Да, удалить отзыв", callback_data: `review-delete-confirm:${reviewId}` }],
      [{ text: "↩️ К отзывам", callback_data: "reviews:list" }],
    ],
  };
}

function starString(rating: number) {
  const value = Math.max(1, Math.min(5, Number(rating) || 1));
  return "★".repeat(value) + "☆".repeat(5 - value);
}

async function isConnectedAdmin(supabase: any, chatId: number) {
  const { data, error } = await supabase
    .from("telegram_admin_chats")
    .select("chat_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function sendRequestList(
  supabase: any,
  botToken: string,
  chatId: number,
  filter: "all" | "new" | "answered" | "rejected"
) {
  let query = supabase
    .from("project_requests")
    .select("id, request_number, name, contact_details, text, status, created_at")
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
      `<b>№${item.request_number}. ${escapeHtml(item.name)}</b>`,
      `📞 ${escapeHtml(item.contact_details)}`,
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
      text: `👁 №${item.request_number}: ${item.name.slice(0, 28)}`,
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
    .select("id, request_number, name, contact_details, text, status, admin_reply, created_at, updated_at")
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
    `<b>👁 Заявка №${data.request_number}</b>`,
    "",
    `<b>👤 Клиент:</b> ${escapeHtml(data.name)}`,
    `<b>📞 Контакт:</b> ${escapeHtml(data.contact_details)}`,
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

async function sendReviewList(supabase: any, botToken: string, chatId: number) {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, name, text, rating, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) throw error;

  const reviews = data || [];
  const rows = reviews.map((review: any, index: number) => {
    const createdAt = new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Yekaterinburg",
    }).format(new Date(review.created_at));
    return [
      `<b>${index + 1}. ${escapeHtml(review.name)}</b> · ${starString(review.rating)}`,
      `💬 ${escapeHtml(String(review.text).slice(0, 260))}`,
      `🕒 ${createdAt}`,
    ].join("\n");
  });
  const deleteButtons = reviews.map((review: any, index: number) => [
    {
      text: `🗑 Удалить отзыв ${index + 1}: ${String(review.name).slice(0, 24)}`,
      callback_data: `review-delete:${review.id}`,
    },
  ]);

  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: rows.length
      ? `<b>⭐ Отзывы на сайте</b>\n\n${rows.join("\n\n────────────\n\n")}`
      : "<b>⭐ Отзывы на сайте</b>\n\nСейчас отзывов нет.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [...deleteButtons, ...reviewMenu().inline_keyboard],
    },
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
      const isKnownChat = await isConnectedAdmin(supabase, chat.id);
      const { count, error: chatCountError } = await supabase
        .from("telegram_admin_chats")
        .select("*", { count: "exact", head: true });
      if (chatCountError) throw chatCountError;

      if (!isKnownChat && count) {
        await telegramRequest(botToken, "sendMessage", {
          chat_id: chat.id,
          text: "Доступ к этому боту ограничен.",
        });
        return new Response("ok", { status: 200 });
      }

      if (!isKnownChat) {
        await supabase.from("telegram_admin_chats").upsert({
          chat_id: chat.id,
          chat_type: chat.type,
          display_name: [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "Admin",
        });
      }

      await telegramRequest(botToken, "sendMessage", {
        chat_id: chat.id,
        text: "<b>✨ Frog Oxide: бот подключён</b>\n\nНовые заявки с сайта будут приходить сюда сразу после отправки.\n\nВыберите, какие заявки посмотреть, или нажмите кнопку в уведомлении, чтобы изменить её статус.",
        parse_mode: "HTML",
        reply_markup: requestMenu(),
      });
    }

    const callback = update.callback_query;
    if (callback && !await isConnectedAdmin(supabase, callback.message.chat.id)) {
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Нет доступа к заявкам",
        show_alert: true,
      });
      return new Response("ok", { status: 200 });
    }

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

    if (callback && String(callback.data || "") === "reviews:list") {
      await sendReviewList(supabase, botToken, callback.message.chat.id);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Отзывы загружены",
      });
      return new Response("ok", { status: 200 });
    }

    const reviewDeleteMatch = String(callback?.data || "").match(/^review-delete:([0-9a-f-]{36})$/i);
    if (callback && reviewDeleteMatch) {
      const { data, error } = await supabase
        .from("reviews")
        .select("name")
        .eq("id", reviewDeleteMatch[1])
        .maybeSingle();
      if (error || !data) throw error || new Error("Review not found");

      await telegramRequest(botToken, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: `⚠️ <b>Удалить отзыв от ${escapeHtml(data.name)}?</b>\nЭто действие нельзя отменить.`,
        parse_mode: "HTML",
        reply_markup: reviewDeleteConfirmation(reviewDeleteMatch[1]),
      });
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Подтвердите удаление отзыва",
      });
      return new Response("ok", { status: 200 });
    }

    const reviewDeleteConfirmMatch = String(callback?.data || "").match(/^review-delete-confirm:([0-9a-f-]{36})$/i);
    if (callback && reviewDeleteConfirmMatch) {
      const { data, error } = await supabase
        .from("reviews")
        .delete()
        .eq("id", reviewDeleteConfirmMatch[1])
        .select("name")
        .maybeSingle();
      if (error || !data) throw error || new Error("Review not found");

      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Отзыв успешно удалён",
      });
      await telegramRequest(botToken, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: `✅ <b>Успешно удалено</b>\n\nОтзыв от ${escapeHtml(data.name)} удалён с сайта.`,
        parse_mode: "HTML",
      });
      return new Response("ok", { status: 200 });
    }

    const deleteMatch = String(callback?.data || "").match(/^delete:([0-9a-f-]{36})$/i);
    if (callback && deleteMatch) {
      const { data, error } = await supabase
        .from("project_requests")
        .select("request_number")
        .eq("id", deleteMatch[1])
        .maybeSingle();
      if (error || !data) throw error || new Error("Request not found");

      await telegramRequest(botToken, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: `⚠️ <b>Удалить заявку №${data.request_number}?</b>\nЭто действие нельзя отменить.`,
        parse_mode: "HTML",
        reply_markup: deleteConfirmation(deleteMatch[1]),
      });
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Подтвердите удаление",
      });
      return new Response("ok", { status: 200 });
    }

    const deleteConfirmMatch = String(callback?.data || "").match(/^delete-confirm:([0-9a-f-]{36})$/i);
    if (callback && deleteConfirmMatch) {
      const { data, error } = await supabase
        .from("project_requests")
        .delete()
        .eq("id", deleteConfirmMatch[1])
        .select("request_number")
        .maybeSingle();
      if (error || !data) throw error || new Error("Request not found");

      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: `Успешно удалено: заявка №${data.request_number}`,
      });
      await telegramRequest(botToken, "sendMessage", {
        chat_id: callback.message.chat.id,
        text: `✅ <b>Успешно удалено</b>\n\nЗаявка №${data.request_number} удалена из базы.`,
        parse_mode: "HTML",
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
