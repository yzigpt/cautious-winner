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

async function cryptoPayRequest(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://pay.crypt.bot/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": token },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result?.error?.name || `Crypto Pay ${method} failed`);
  return result.result;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char));
}

function statusLabel(status: string) {
  if (status === "completed") return "\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430";
  if (status === "answered") return "✅ Принята";
  if (status === "rejected") return "🚫 Отклонена";
  return "🆕 Новая";
}

function cryptoDealStatusLabel(status: string) {
  const labels: Record<string, string> = {
    awaiting_counterparty: "Ожидает вторую сторону", awaiting_payment: "Ожидает оплату", paid: "Оплачено",
    awaiting_buyer_confirmation: "Ожидает покупателя", payout_processing: "Выплата обрабатывается",
    completed: "Завершена", disputed: "Остановлена / спор", refund_processing: "Возврат обрабатывается",
    refunded: "Возвращена покупателю", cancelled: "Отменена",
  };
  return labels[status] || status;
}

function guarantorMenu() {
  return { inline_keyboard: [
    [{ text: "Все сделки", callback_data: "guarantor:list:0" }],
    [{ text: "Открыть Frog Garant", url: "https://t.me/FrogGarant_bot" }],
    [{ text: "Control Center", callback_data: "dashboard:home" }],
  ] };
}

async function sendGuarantorPanel(supabase: any, botToken: string, chatId: number) {
  const { data, error } = await supabase.from("crypto_deals").select("status").is("admin_archived_at", null);
  if (error) throw error;
  const deals = data || [];
  const active = deals.filter((deal: any) => ["paid", "awaiting_buyer_confirmation", "disputed"].includes(deal.status)).length;
  await telegramRequest(botToken, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `<b>Гарант · управление сделками</b>\n\nВсего: <b>${deals.length}</b>\nТребуют внимания: <b>${active}</b>\n\nВозврат USDT доступен только для оплаченных незавершённых сделок и всегда требует подтверждения.`, reply_markup: guarantorMenu() });
}

async function sendGuarantorDeals(supabase: any, botToken: string, chatId: number, offset = 0) {
  const { data, error, count } = await supabase.from("crypto_deals").select("id, deal_number, amount_usdt, status, buyer_chat_id, seller_chat_id, created_at", { count: "exact" }).is("admin_archived_at", null).order("created_at", { ascending: false }).range(offset, offset + 9);
  if (error) throw error;
  const deals = data || [];
  const participantIds = [...new Set(deals.flatMap((deal: any) => [deal.buyer_chat_id, deal.seller_chat_id]).filter(Boolean))];
  const { data: profiles, error: profilesError } = await supabase.from("crypto_guarantor_profiles").select("chat_id, telegram_username").in("chat_id", participantIds);
  if (profilesError) throw profilesError;
  const names = new Map((profiles || []).map((profile: any) => [Number(profile.chat_id), String(profile.telegram_username || "Без имени")]));
  const summary = deals.map((deal: any) => `#${deal.deal_number} · <b>${deal.amount_usdt} USDT</b>\nПокупатель: ${escapeHtml(names.get(Number(deal.buyer_chat_id)) || "не подключён")}\nПродавец: ${escapeHtml(names.get(Number(deal.seller_chat_id)) || "не подключён")}\n${cryptoDealStatusLabel(deal.status)}`).join("\n\n");
  const buttons: any[] = deals.map((deal: any) => [{ text: `Открыть сделку #${deal.deal_number}`, callback_data: `guarantor:view:${deal.id}` }]);
  const nav: any[] = [];
  if (offset > 0) nav.push({ text: "Назад", callback_data: `guarantor:list:${Math.max(0, offset - 10)}` });
  if (offset + 10 < Number(count || 0)) nav.push({ text: "Вперёд", callback_data: `guarantor:list:${offset + 10}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "К панели гаранта", callback_data: "guarantor:menu" }]);
  await telegramRequest(botToken, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `<b>ГАРАНТ · ВСЕ СДЕЛКИ</b>\n<code>CONTROL / USDT / LIVE</code>\n\n${summary || "Сделок пока нет."}`, reply_markup: { inline_keyboard: buttons } });
}

async function sendGuarantorDealDetails(supabase: any, botToken: string, chatId: number, dealId: string) {
  const { data: deal, error } = await supabase.from("crypto_deals").select("*").eq("id", dealId).maybeSingle();
  if (error || !deal) throw error || new Error("Crypto deal not found");
  const { data: profiles, error: profilesError } = await supabase.from("crypto_guarantor_profiles").select("chat_id, telegram_username").in("chat_id", [deal.buyer_chat_id, deal.seller_chat_id].filter(Boolean));
  if (profilesError) throw profilesError;
  const names = new Map((profiles || []).map((profile: any) => [Number(profile.chat_id), String(profile.telegram_username || "Без имени")]));
  const buyerName = names.get(Number(deal.buyer_chat_id)) || "не подключён";
  const sellerName = names.get(Number(deal.seller_chat_id)) || "не подключён";
  const canRefund = ["paid", "awaiting_buyer_confirmation", "disputed"].includes(deal.status);
  const actions: any[] = [];
  if (deal.buyer_chat_id || deal.seller_chat_id) {
    const participantLinks: any[] = [];
    if (deal.buyer_chat_id) participantLinks.push({ text: "Открыть покупателя", url: `tg://user?id=${deal.buyer_chat_id}` });
    if (deal.seller_chat_id) participantLinks.push({ text: "Открыть продавца", url: `tg://user?id=${deal.seller_chat_id}` });
    actions.push(participantLinks);
  }
  if (canRefund) actions.push([{ text: "Вернуть деньги покупателю", callback_data: `guarantor:refund:${deal.id}` }]);
  if (!["completed", "refunded", "refund_processing", "cancelled", "disputed"].includes(deal.status)) actions.push([{ text: "Остановить сделку", callback_data: `guarantor:stop:${deal.id}` }]);
  if (!["payout_processing", "refund_processing"].includes(deal.status)) actions.push([{ text: "Удалить из списка", callback_data: `guarantor:delete:${deal.id}` }]);
  actions.push([{ text: "Все сделки", callback_data: "guarantor:list:0" }]);
  await telegramRequest(botToken, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: [`<b>СДЕЛКА #${deal.deal_number}</b>`, `<code>GUARANTOR / USDT</code>`, "", `Сумма: <b>${deal.amount_usdt} USDT</b>`, `Комиссия: ${deal.fee_usdt} USDT`, `Выплата продавцу: ${deal.seller_payout_usdt} USDT`, `Статус: <b>${cryptoDealStatusLabel(deal.status)}</b>`, "", `Покупатель: <b>${escapeHtml(buyerName)}</b> · <code>${deal.buyer_chat_id || "не подключён"}</code>`, `Продавец: <b>${escapeHtml(sellerName)}</b> · <code>${deal.seller_chat_id || "не подключён"}</code>`, "", `<b>Условия</b>\n${escapeHtml(String(deal.terms || "Не указаны"))}`].join("\n"), reply_markup: { inline_keyboard: actions } });
}

function controlCenterMenu() {
  return {
    inline_keyboard: [
      [{ text: "\u{1F4CB} \u0412\u0441\u0435 \u0437\u0430\u044F\u0432\u043A\u0438", callback_data: "list:all:0" }],
      [
        { text: "\u{1F195} \u041D\u043E\u0432\u044B\u0435", callback_data: "list:new:0" },
        { text: "\u{2705} \u0412 \u0440\u0430\u0431\u043E\u0442\u0435", callback_data: "list:answered:0" },
      ],
      [
        { text: "\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435", callback_data: "list:completed:0" },
        { text: "\u{1F6AB} \u041E\u0442\u043A\u043B\u043E\u043D\u0451\u043D\u043D\u044B\u0435", callback_data: "list:rejected:0" },
      ],
      [
        { text: "\u{2B50} \u041E\u0442\u0437\u044B\u0432\u044B", callback_data: "reviews:list" },
        { text: "\u{1F310} \u0421\u0430\u0439\u0442", callback_data: "site:menu" },
      ],
      [{ text: "\u{1F6E1}\u{FE0F} \u0413\u0430\u0440\u0430\u043D\u0442", callback_data: "guarantor:menu" }],
      [{ text: "\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438", callback_data: "users:list:0" }],
    ],
  };
}

async function sendControlCenter(supabase: any, botToken: string, chatId: number) {
  const { data: result, error } = await supabase.rpc("get_control_center_stats");
  const stats = Array.isArray(result) ? result[0] : result;
  if (error || !stats) throw error || new Error("Could not load control center stats");
  const totalRequests = Number(stats.total_requests || 0);
  const newRequests = Number(stats.new_requests || 0);
  const activeRequests = Number(stats.active_requests || 0);
  const completedRequests = Number(stats.completed_requests || 0);
  const totalReviews = Number(stats.total_reviews || 0);
  const requestsEnabled = stats.requests_enabled !== false;
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: [
      "<b>\u{2726} FROG OXIDE</b>",
      "<code>CONTROL CENTER  /  ONLINE</code>",
      "",
      `<b>\u{1F4E5} \u0412\u0441\u0435\u0433\u043E \u0437\u0430\u044F\u0432\u043E\u043A:</b> ${totalRequests || 0}`,
      `<b>\u{1F195} \u041D\u043E\u0432\u044B\u0435:</b> ${newRequests || 0}    <b>\u{2705} \u0412 \u0440\u0430\u0431\u043E\u0442\u0435:</b> ${activeRequests || 0}`,
      `<b>\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E:</b> ${completedRequests || 0}    <b>\u{2B50} \u041E\u0442\u0437\u044B\u0432\u043E\u0432:</b> ${totalReviews || 0}`,
      "",
      `<b>\u{1F310} \u0421\u0430\u0439\u0442:</b> ${requestsEnabled ? "\u{1F7E2} \u043F\u0440\u0438\u0451\u043C \u0437\u0430\u044F\u0432\u043E\u043A \u043E\u0442\u043A\u0440\u044B\u0442" : "\u{1F7E0} \u043F\u0440\u0438\u0451\u043C \u0437\u0430\u044F\u0432\u043E\u043A \u043F\u0430\u0443\u0437\u0435"}`,
      "",
      "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0430\u0437\u0434\u0435\u043B \u043D\u0438\u0436\u0435.",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: controlCenterMenu(),
  });
}

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
  account_status: "active" | "frozen" | "blocked";
  ip_hash: string | null;
  ip_status: "active" | "frozen" | "blocked";
};

function accessStatusLabel(status: string) {
  if (status === "blocked") return "\u{1F6AB} \u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D";
  if (status === "frozen") return "\u{1F9CA} \u0417\u0430\u043C\u043E\u0440\u043E\u0436\u0435\u043D";
  return "\u{1F7E2} \u0410\u043A\u0442\u0438\u0432\u0435\u043D";
}

function siteDisplayName(user: any) {
  return String(user.user_metadata?.display_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C");
}

async function loadManagedUsers(supabase: any) {
  const [{ data: userPage, error: usersError }, { data: controls, error: controlsError }, { data: ipControls, error: ipError }] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
    supabase.from("account_access_controls").select("user_id, account_status, ip_hash"),
    supabase.from("ip_access_controls").select("ip_hash, access_status"),
  ]);
  if (usersError || controlsError || ipError) throw usersError || controlsError || ipError;
  const controlsByUser = new Map((controls || []).map((item: any) => [item.user_id, item]));
  const ipStatusByHash = new Map((ipControls || []).map((item: any) => [item.ip_hash, item.access_status]));
  return (userPage.users || []).map((user: any): ManagedUser => {
    const control = controlsByUser.get(user.id);
    return {
      id: user.id,
      email: user.email || "",
      name: siteDisplayName(user),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      account_status: control?.account_status || "active",
      ip_hash: control?.ip_hash || null,
      ip_status: control?.ip_hash ? (ipStatusByHash.get(control.ip_hash) || "active") : "active",
    };
  });
}

function usersMenu(offset: number, total: number) {
  const navigation = [] as any[];
  if (offset > 0) navigation.push({ text: "\u{2B05}\u{FE0F} \u041D\u0430\u0437\u0430\u0434", callback_data: `users:list:${Math.max(0, offset - 10)}` });
  if (offset + 10 < total) navigation.push({ text: "\u0412\u043F\u0435\u0440\u0451\u0434 \u27A1\u{FE0F}", callback_data: `users:list:${offset + 10}` });
  return {
    inline_keyboard: [
      ...(navigation.length ? [navigation] : []),
      [{ text: "\u25C6 Control Center", callback_data: "dashboard:home" }],
    ],
  };
}

async function sendUsersList(supabase: any, botToken: string, chatId: number, offset = 0) {
  const users = await loadManagedUsers(supabase);
  const page = users.slice(offset, offset + 10);
  const rows = page.map((user, index) => [
    `<b>${offset + index + 1}. ${escapeHtml(user.name)}</b>`,
    `\u{1F4E7} ${escapeHtml(user.email)}`,
    `\u{1F512} ${accessStatusLabel(user.account_status)}  |  IP: ${accessStatusLabel(user.ip_status)}`,
  ].join("\n"));
  const userButtons = page.map((user, index) => [{
    text: `\u{1F464} ${offset + index + 1}. ${user.name.slice(0, 28)}`,
    callback_data: `user:view:${user.id}`,
  }]);
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: rows.length
      ? `<b>\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438</b> <code>${offset + 1}-${offset + page.length} / ${users.length}</code>\n\n${rows.join("\n\n────────────\n\n")}`
      : "<b>\u{1F465} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438</b>\n\n\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u043E\u0432.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [...userButtons, ...usersMenu(offset, users.length).inline_keyboard] },
  });
}

async function sendUserDetails(supabase: any, botToken: string, chatId: number, userId: string) {
  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(userId);
  if (authError || !authResult.user) throw authError || new Error("User not found");
  const user = authResult.user;
  const { data: control, error: controlError } = await supabase
    .from("account_access_controls")
    .select("account_status, ip_hash, last_seen_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (controlError) throw controlError;
  const { data: ipControl, error: ipError } = control?.ip_hash
    ? await supabase.from("ip_access_controls").select("access_status").eq("ip_hash", control.ip_hash).maybeSingle()
    : { data: null, error: null };
  if (ipError) throw ipError;
  const accountStatus = control?.account_status || "active";
  const ipStatus = ipControl?.access_status || "active";
  const fingerprint = control?.ip_hash ? `${control.ip_hash.slice(0, 10)}...${control.ip_hash.slice(-6)}` : "\u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u0438";
  const createdAt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Yekaterinburg" }).format(new Date(user.created_at));
  const actions = [] as any[];
  if (accountStatus === "frozen") {
    actions.push([{ text: "\u{1F9CA} \u0420\u0430\u0437\u043C\u043E\u0440\u043E\u0437\u0438\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442", callback_data: `user:account:${userId}:active` }]);
  } else if (accountStatus === "blocked") {
    actions.push([{ text: "\u{1F513} \u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442", callback_data: `user:account:${userId}:active` }]);
  } else {
    actions.push([
      { text: "\u{1F9CA} \u0417\u0430\u043C\u043E\u0440\u043E\u0437\u0438\u0442\u044C", callback_data: `user:account:${userId}:frozen` },
      { text: "\u{1F6AB} \u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C", callback_data: `user:account:${userId}:blocked` },
    ]);
  }
  if (control?.ip_hash) {
    if (ipStatus === "frozen") {
      actions.push([{ text: "\u{1F9CA} \u0420\u0430\u0437\u043C\u043E\u0440\u043E\u0437\u0438\u0442\u044C IP", callback_data: `user:ip:${userId}:active` }]);
    } else if (ipStatus === "blocked") {
      actions.push([{ text: "\u{1F513} \u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C IP", callback_data: `user:ip:${userId}:active` }]);
    } else {
      actions.push([
        { text: "\u{1F9CA} \u0417\u0430\u043C\u043E\u0440\u043E\u0437\u0438\u0442\u044C IP", callback_data: `user:ip:${userId}:frozen` },
        { text: "\u{1F6AB} \u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C IP", callback_data: `user:ip:${userId}:blocked` },
      ]);
    }
  }
  actions.push([{ text: "\u{2B05}\u{FE0F} \u041A \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F\u043C", callback_data: "users:list:0" }]);
  actions.push([{ text: "\u25C6 Control Center", callback_data: "dashboard:home" }]);

  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: [
      "<b>\u{1F464} \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C</b>",
      "",
      `<b>\u0418\u043C\u044F:</b> ${escapeHtml(siteDisplayName(user))}`,
      `<b>Email:</b> ${escapeHtml(user.email || "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D")}`,
      `<b>\u0410\u043A\u043A\u0430\u0443\u043D\u0442:</b> ${accessStatusLabel(accountStatus)}`,
      `<b>IP:</b> ${accessStatusLabel(ipStatus)}`,
      `<b>IP \u043E\u0442\u043F\u0435\u0447\u0430\u0442\u043E\u043A:</b> <code>${fingerprint}</code>`,
      `<b>\u0421\u043E\u0437\u0434\u0430\u043D:</b> ${createdAt}`,
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: actions },
  });
}

async function updateManagedUserAccess(supabase: any, userId: string, target: "account" | "ip", status: "active" | "frozen" | "blocked") {
  const { data: current, error: currentError } = await supabase
    .from("account_access_controls")
    .select("account_status, ip_hash")
    .eq("user_id", userId)
    .maybeSingle();
  if (currentError) throw currentError;
  const accountStatus = target === "account" ? status : (current?.account_status || "active");
  const { error: accountError } = await supabase.from("account_access_controls").upsert({
    user_id: userId,
    account_status: accountStatus,
    ip_hash: current?.ip_hash || null,
    last_seen_at: new Date().toISOString(),
  });
  if (accountError) throw accountError;
  if (target === "ip" && current?.ip_hash) {
    if (status === "active") {
      const { error } = await supabase.from("ip_access_controls").delete().eq("ip_hash", current.ip_hash);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("ip_access_controls").upsert({ ip_hash: current.ip_hash, access_status: status });
      if (error) throw error;
    }
  }
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
      [{ text: "📋 Все заявки", callback_data: "list:all:0" }],
      [
        { text: "🆕 Новые", callback_data: "list:new:0" },
        { text: "✅ Принятые", callback_data: "list:answered:0" },
      ],
      [{ text: "🚫 Отклонённые", callback_data: "list:rejected:0" }],
      [{ text: "⭐ Управление отзывами", callback_data: "reviews:list" }],
      [{ text: "🌐 Управление сайтом", callback_data: "site:menu" }],
    ],
  };
}

function siteManagementMenu(requestsEnabled: boolean) {
  return {
    inline_keyboard: [
      [{ text: requestsEnabled ? "⏸ Остановить приём заявок" : "▶️ Включить приём заявок", callback_data: "site:toggle-requests" }],
      [{ text: "🔄 Обновить панель", callback_data: "site:menu" }],
      [{ text: "🔗 Открыть сайт", url: "https://yzigpt.github.io/cautious-winner/" }],
      [{ text: "📋 К заявкам", callback_data: "list:all:0" }],
    ],
  };
}

async function sendSiteManagementPanel(supabase: any, botToken: string, chatId: number) {
  const [{ data: settings, error: settingsError }, { count: totalRequests, error: requestsError }, { count: totalReviews, error: reviewsError }] = await Promise.all([
    supabase.from("site_settings").select("requests_enabled").eq("id", 1).maybeSingle(),
    supabase.from("project_requests").select("*", { count: "exact", head: true }),
    supabase.from("reviews").select("*", { count: "exact", head: true }),
  ]);
  if (settingsError || requestsError || reviewsError) throw settingsError || requestsError || reviewsError;
  const requestsEnabled = settings?.requests_enabled !== false;
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: [
      "<b>🌐 Управление сайтом</b>",
      "",
      `<b>Приём заявок:</b> ${requestsEnabled ? "✅ включён" : "⏸ временно выключен"}`,
      `<b>Всего заявок:</b> ${totalRequests || 0}`,
      `<b>Отзывов на сайте:</b> ${totalReviews || 0}`,
      "",
      "Используйте кнопку ниже, чтобы временно закрыть или открыть форму заявок.",
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: siteManagementMenu(requestsEnabled),
  });
}

function reviewMenu() {
  return {
    inline_keyboard: [
      [{ text: "🔄 Обновить отзывы", callback_data: "reviews:list" }],
      [{ text: "📋 К заявкам", callback_data: "list:all:0" }],
    ],
  };
}

function requestActions(requestId: string) {
  return {
    inline_keyboard: [
      [{ text: "👁 Открыть заявку", callback_data: `view:${requestId}` }],
      [
        { text: "✅ Взять в работу", callback_data: `request:${requestId}:answered` },
        { text: "🚫 Отклонить", callback_data: `request:${requestId}:rejected` },
      ],
      [{ text: "🗑 Удалить заявку", callback_data: `delete:${requestId}` }],
      [{ text: "📋 К списку заявок", callback_data: "list:all:0" }],
    ],
  };
}

function requestMenuWithCompletion() {
  const menu = requestMenu();
  menu.inline_keyboard.splice(2, 0, [
    { text: "\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435", callback_data: "list:completed:0" },
  ]);
  menu.inline_keyboard.push([
    { text: "\u{25C6} Control Center", callback_data: "dashboard:home" },
  ]);
  return menu;
}

function requestActionsWithCompletion(requestId: string) {
  const actions = requestActions(requestId);
  actions.inline_keyboard.splice(2, 0, [
    { text: "\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C", callback_data: `request:${requestId}:completed` },
  ]);
  actions.inline_keyboard.push([
    { text: "\u{25C6} Control Center", callback_data: "dashboard:home" },
  ]);
  return actions;
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

async function isConnectedAdmin(_supabase: any, chatId: number) {
  const configuredChatId = Number(Deno.env.get("TELEGRAM_ADMIN_CHAT_ID"));
  return Number.isSafeInteger(configuredChatId) && configuredChatId === chatId;
}

async function sendRequestList(
  supabase: any,
  botToken: string,
  chatId: number,
  filter: "all" | "new" | "answered" | "rejected" | "completed",
  offset = 0
) {
  let query = supabase
    .from("project_requests")
    .select("id, request_number, name, contact_details, text, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + 11);

  if (filter !== "all") query = query.eq("status", filter);

  const { data, error, count } = await query;
  if (error) throw error;
  const requests = (data || []) as ProjectRequest[];

  const heading =
    filter === "completed"
      ? "\u{1F3C1} <b>\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0435 \u0437\u0430\u044F\u0432\u043A\u0438</b>"
      : filter === "all"
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
  const paginationButtons = [];
  if (offset > 0) {
    paginationButtons.push({
      text: "⬅️ Назад",
      callback_data: `list:${filter}:${Math.max(0, offset - 12)}`,
    });
  }
  if (offset + requests.length < (count || 0)) {
    paginationButtons.push({
      text: "Вперёд ➡️",
      callback_data: `list:${filter}:${offset + 12}`,
    });
  }

  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        ...detailButtons,
        ...(paginationButtons.length ? [paginationButtons] : []),
        ...requestMenuWithCompletion().inline_keyboard,
      ],
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
    reply_markup: requestActionsWithCompletion(data.id),
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
    const command = String(message?.text || "").trim().toLowerCase().split(/\s+/)[0].split("@")[0];
    if (message?.chat && !await isConnectedAdmin(supabase, message.chat.id)) {
      await telegramRequest(botToken, "sendMessage", {
        chat_id: message.chat.id,
        text: "\u{1F512} \u042D\u0442\u043E\u0442 \u0431\u043E\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443.",
      });
      return new Response("ok", { status: 200 });
    }
    if (message?.chat && ["/start", "/help"].includes(command)) {
      const chat = message.chat;
      const isKnownChat = await isConnectedAdmin(supabase, chat.id);
      const { count, error: chatCountError } = await supabase
        .from("telegram_admin_chats")
        .select("*", { count: "exact", head: true });
      if (chatCountError) throw chatCountError;

      if (!isKnownChat && count) {
        await telegramRequest(botToken, "sendMessage", {
          chat_id: chat.id,
          text: "\u{1F512} \u0414\u043E\u0441\u0442\u0443\u043F \u043A \u0446\u0435\u043D\u0442\u0440\u0443 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D.",
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

      await sendControlCenter(supabase, botToken, chat.id);
      return new Response("ok", { status: 200 });
    }
    if (message?.chat && ["/start", "/requests", "/заявки", "/reviews", "/отзывы", "/site", "/сайт", "/help"].includes(command)) {
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

      if (["/requests", "/заявки"].includes(command)) {
        await sendRequestList(supabase, botToken, chat.id, "all");
        return new Response("ok", { status: 200 });
      }

      if (["/reviews", "/отзывы"].includes(command)) {
        await sendReviewList(supabase, botToken, chat.id);
        return new Response("ok", { status: 200 });
      }

      if (["/site", "/сайт"].includes(command)) {
        await sendSiteManagementPanel(supabase, botToken, chat.id);
        return new Response("ok", { status: 200 });
      }

      await telegramRequest(botToken, "sendMessage", {
        chat_id: chat.id,
        text: "<b>✨ Frog Oxide Control Center</b>\n\nВаш аккуратный центр управления сайтом. Новые заявки приходят сюда мгновенно, а статусы синхронизируются с личными кабинетами клиентов.\n\n<b>Быстрые команды:</b>\n/requests - заявки\n/reviews - отзывы\n/site - управление сайтом",
        parse_mode: "HTML",
        reply_markup: requestMenuWithCompletion(),
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

    if (callback && String(callback.data || "") === "guarantor:menu") {
      await sendGuarantorPanel(supabase, botToken, callback.message.chat.id);
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Панель гаранта открыта" });
      return new Response("ok", { status: 200 });
    }

    const guarantorListMatch = String(callback?.data || "").match(/^guarantor:list:(\d+)$/);
    if (callback && guarantorListMatch) {
      await sendGuarantorDeals(supabase, botToken, callback.message.chat.id, Number(guarantorListMatch[1] || 0));
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Список сделок обновлён" });
      return new Response("ok", { status: 200 });
    }

    const guarantorViewMatch = String(callback?.data || "").match(/^guarantor:view:([0-9a-f-]{36})$/i);
    if (callback && guarantorViewMatch) {
      await sendGuarantorDealDetails(supabase, botToken, callback.message.chat.id, guarantorViewMatch[1]);
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Сделка открыта" });
      return new Response("ok", { status: 200 });
    }

    const guarantorStopMatch = String(callback?.data || "").match(/^guarantor:stop:([0-9a-f-]{36})$/i);
    if (callback && guarantorStopMatch) {
      const { data: deal, error } = await supabase.from("crypto_deals").update({ status: "disputed" }).eq("id", guarantorStopMatch[1]).in("status", ["awaiting_counterparty", "awaiting_payment", "paid", "awaiting_buyer_confirmation"]).select("deal_number, buyer_chat_id, seller_chat_id").maybeSingle();
      if (error || !deal) throw error || new Error("Deal cannot be stopped");
      await Promise.all([
        telegramRequest(botToken, "sendMessage", { chat_id: deal.buyer_chat_id, text: `Сделка #${deal.deal_number} остановлена администратором. Выплата не будет выполнена до решения спора.` }),
        telegramRequest(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: `Сделка #${deal.deal_number} остановлена администратором. Выплата не будет выполнена до решения спора.` }),
      ]);
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Сделка остановлена" });
      await sendGuarantorDealDetails(supabase, botToken, callback.message.chat.id, guarantorStopMatch[1]);
      return new Response("ok", { status: 200 });
    }

    const guarantorRefundMatch = String(callback?.data || "").match(/^guarantor:refund:([0-9a-f-]{36})$/i);
    if (callback && guarantorRefundMatch) {
      const { data: deal, error } = await supabase.from("crypto_deals").select("deal_number, amount_usdt, status").eq("id", guarantorRefundMatch[1]).maybeSingle();
      if (error || !deal || !["paid", "awaiting_buyer_confirmation", "disputed"].includes(deal.status)) throw error || new Error("Refund is unavailable");
      await telegramRequest(botToken, "sendMessage", { chat_id: callback.message.chat.id, parse_mode: "HTML", text: `<b>Вернуть ${deal.amount_usdt} USDT покупателю по сделке #${deal.deal_number}?</b>\n\nДеньги будут отправлены через Crypto Pay. Это действие нельзя отменить.`, reply_markup: { inline_keyboard: [[{ text: "Да, вернуть USDT", callback_data: `guarantor:refund-confirm:${guarantorRefundMatch[1]}` }], [{ text: "Отмена", callback_data: `guarantor:view:${guarantorRefundMatch[1]}` }]] } });
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Подтвердите возврат" });
      return new Response("ok", { status: 200 });
    }

    const guarantorRefundConfirmMatch = String(callback?.data || "").match(/^guarantor:refund-confirm:([0-9a-f-]{36})$/i);
    if (callback && guarantorRefundConfirmMatch) {
      const { data: result, error } = await supabase.rpc("claim_crypto_deal_refund", { p_deal_id: guarantorRefundConfirmMatch[1] });
      const refund = Array.isArray(result) ? result[0] : result;
      if (error || !refund) throw error || new Error("Refund is unavailable");
      try {
        const cryptoToken = Deno.env.get("CRYPTO_PAY_API_TOKEN");
        if (!cryptoToken) throw new Error("Crypto Pay is not configured");
        const transfer = await cryptoPayRequest(cryptoToken, "transfer", { user_id: refund.buyer_chat_id, asset: "USDT", amount: String(refund.amount_usdt), spend_id: `admin-refund-${guarantorRefundConfirmMatch[1]}`, comment: `Возврат по сделке #${refund.deal_number}` });
        const { data: deal, error: updateError } = await supabase.from("crypto_deals").update({ status: "refunded", refund_transfer_id: transfer.transfer_id, refunded_at: new Date().toISOString() }).eq("id", guarantorRefundConfirmMatch[1]).select("buyer_chat_id, seller_chat_id, deal_number, amount_usdt").single();
        if (updateError || !deal) throw updateError || new Error("Refund update failed");
        await Promise.all([
          telegramRequest(botToken, "sendMessage", { chat_id: deal.buyer_chat_id, text: `По сделке #${deal.deal_number} администратор отправил вам возврат ${deal.amount_usdt} USDT.` }),
          telegramRequest(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: `Сделка #${deal.deal_number} отменена администратором. Деньги возвращены покупателю.` }),
        ]);
        await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Возврат успешно отправлен" });
      } catch (refundError) {
        await supabase.from("crypto_deals").update({ status: "disputed", last_error: String(refundError).slice(0, 500) }).eq("id", guarantorRefundConfirmMatch[1]);
        throw refundError;
      }
      return new Response("ok", { status: 200 });
    }

    const guarantorDeleteMatch = String(callback?.data || "").match(/^guarantor:delete:([0-9a-f-]{36})$/i);
    if (callback && guarantorDeleteMatch) {
      const { data: deal, error } = await supabase.from("crypto_deals").select("deal_number, status").eq("id", guarantorDeleteMatch[1]).is("admin_archived_at", null).maybeSingle();
      if (error || !deal || ["payout_processing", "refund_processing"].includes(deal.status)) throw error || new Error("Deal cannot be archived");
      await telegramRequest(botToken, "sendMessage", {
        chat_id: callback.message.chat.id,
        parse_mode: "HTML",
        text: `<b>Удалить сделку #${deal.deal_number} из списка гаранта?</b>\n\nСделка будет скрыта из панели, но запись сохранится в финансовом журнале.`,
        reply_markup: { inline_keyboard: [[{ text: "Да, удалить из списка", callback_data: `guarantor:delete-confirm:${guarantorDeleteMatch[1]}` }], [{ text: "Отмена", callback_data: `guarantor:view:${guarantorDeleteMatch[1]}` }]] },
      });
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Подтвердите удаление" });
      return new Response("ok", { status: 200 });
    }

    const guarantorDeleteConfirmMatch = String(callback?.data || "").match(/^guarantor:delete-confirm:([0-9a-f-]{36})$/i);
    if (callback && guarantorDeleteConfirmMatch) {
      const { data: deal, error } = await supabase.from("crypto_deals")
        .update({ admin_archived_at: new Date().toISOString() })
        .eq("id", guarantorDeleteConfirmMatch[1])
        .is("admin_archived_at", null)
        .in("status", ["awaiting_counterparty", "awaiting_payment", "paid", "awaiting_buyer_confirmation", "completed", "disputed", "refunded", "cancelled"])
        .select("deal_number")
        .maybeSingle();
      if (error || !deal) throw error || new Error("Deal cannot be archived");
      await telegramRequest(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: "Сделка удалена из списка" });
      await telegramRequest(botToken, "sendMessage", { chat_id: callback.message.chat.id, text: `Сделка #${deal.deal_number} удалена из списка гаранта.` });
      await sendGuarantorDeals(supabase, botToken, callback.message.chat.id);
      return new Response("ok", { status: 200 });
    }

    if (callback && String(callback.data || "") === "dashboard:home") {
      await sendControlCenter(supabase, botToken, callback.message.chat.id);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "\u0426\u0435\u043D\u0442\u0440 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D",
      });
      return new Response("ok", { status: 200 });
    }

    const usersListMatch = String(callback?.data || "").match(/^users:list:(\d+)$/i);
    if (callback && usersListMatch) {
      await sendUsersList(supabase, botToken, callback.message.chat.id, Number(usersListMatch[1] || 0));
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "\u0421\u043F\u0438\u0441\u043E\u043A \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D",
      });
      return new Response("ok", { status: 200 });
    }

    const userViewMatch = String(callback?.data || "").match(/^user:view:([0-9a-f-]{36})$/i);
    if (callback && userViewMatch) {
      await sendUserDetails(supabase, botToken, callback.message.chat.id, userViewMatch[1]);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043E\u0442\u043A\u0440\u044B\u0442",
      });
      return new Response("ok", { status: 200 });
    }

    const userAccessMatch = String(callback?.data || "").match(/^user:(account|ip):([0-9a-f-]{36}):(active|frozen|blocked)$/i);
    if (callback && userAccessMatch) {
      const [, target, userId, status] = userAccessMatch;
      await updateManagedUserAccess(supabase, userId, target as "account" | "ip", status as "active" | "frozen" | "blocked");
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "\u0414\u043E\u0441\u0442\u0443\u043F \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D",
      });
      await sendUserDetails(supabase, botToken, callback.message.chat.id, userId);
      return new Response("ok", { status: 200 });
    }

    const listMatch = String(callback?.data || "").match(/^list:(all|new|answered|rejected|completed)(?::(\d+))?$/i);
    if (callback && listMatch) {
      const filter = listMatch[1].toLowerCase() as "all" | "new" | "answered" | "rejected" | "completed";
      const offset = Number(listMatch[2] || 0);
      await sendRequestList(supabase, botToken, callback.message.chat.id, filter, offset);
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

    if (callback && String(callback.data || "") === "site:menu") {
      await sendSiteManagementPanel(supabase, botToken, callback.message.chat.id);
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Панель сайта обновлена",
      });
      return new Response("ok", { status: 200 });
    }

    if (callback && String(callback.data || "") === "site:toggle-requests") {
      const { data: current, error: currentError } = await supabase
        .from("site_settings")
        .select("requests_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (currentError) throw currentError;
      const requestsEnabled = !(current?.requests_enabled !== false);
      const { error: updateError } = await supabase
        .from("site_settings")
        .upsert({ id: 1, requests_enabled: requestsEnabled, updated_at: new Date().toISOString() });
      if (updateError) throw updateError;
      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: requestsEnabled ? "Приём заявок включён" : "Приём заявок остановлен",
      });
      await sendSiteManagementPanel(supabase, botToken, callback.message.chat.id);
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
      const { data: result, error } = await supabase.rpc(
        "delete_project_request_and_renumber",
        { p_request_id: deleteConfirmMatch[1] }
      );
      const deletedRequest = Array.isArray(result) ? result[0] : result;
      const data = { request_number: deletedRequest?.deleted_request_number };
      if (error || !data.request_number) throw error || new Error("Request not found");

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

    const match = String(callback?.data || "").match(/^request:([0-9a-f-]{36}):(answered|new|rejected|completed)$/i);
    if (callback && match) {
      const [, requestId, status] = match;
      const { data: updatedRequest, error: updateError } = await supabase
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
        .eq("id", requestId)
        .select("id, request_number, name, contact_details, text, status, created_at")
        .single();
      if (updateError || !updatedRequest) throw updateError || new Error("Request not found");

      await telegramRequest(botToken, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text:
          status === "answered"
            ? "Заявка отмечена как взятая в работу ✅"
            : status === "rejected"
              ? "Заявка отклонена 🚫"
              : "Статус обновлён",
      });

      const createdAt = new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Yekaterinburg",
      }).format(new Date(updatedRequest.created_at));
      await telegramRequest(botToken, "editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: [
          `<b>📌 Заявка №${updatedRequest.request_number}</b>`,
          "",
          `<b>👤 Клиент:</b> ${escapeHtml(updatedRequest.name)}`,
          `<b>📞 Контакт:</b> ${escapeHtml(updatedRequest.contact_details)}`,
          `<b>💬 Задача:</b> ${escapeHtml(updatedRequest.text)}`,
          `<b>🏷 Статус:</b> ${statusLabel(updatedRequest.status)}`,
          `<b>🕒 Время:</b> ${createdAt}`,
        ].join("\n"),
        parse_mode: "HTML",
        reply_markup: requestActionsWithCompletion(updatedRequest.id),
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("ok", { status: 200 });
  }
});
