import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cryptoPayUrl = "https://pay.crypt.bot/api/";
const feeBasisPoints = 300;

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function guarantorAdminChatId() {
  return Deno.env.get("CRYPTO_GUARANTOR_ADMIN_CHAT_ID") || required("TELEGRAM_ADMIN_CHAT_ID");
}

function adminContactMenu() {
  return {
    inline_keyboard: [[{
      text: "Написать администратору",
      url: `tg://user?id=${guarantorAdminChatId()}`,
    }]],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function telegramUrl(token: string, method: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegram(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(telegramUrl(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram ${method} failed: ${response.status}`);
  return await response.json();
}

async function cryptoPay(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`${cryptoPayUrl}${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": token },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result?.error?.name || `Crypto Pay ${method} failed`);
  return result.result;
}

function parseUsdt(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt((fractional + "000000").slice(0, 6));
  return micros > 0n ? micros : null;
}

function formatUsdt(micros: bigint) {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char));
}

function dealText(deal: any) {
  return [
    `<b>Сделка #${deal.deal_number}</b>`,
    `Сумма: <b>${deal.amount_usdt} USDT</b>`,
    `Комиссия сервиса: <b>${deal.fee_usdt} USDT (3%)</b>`,
    `Продавец получит: <b>${deal.seller_payout_usdt} USDT</b>`,
  ].join("\n");
}

function dealTermsText(deal: any) {
  return `<b>Условия сделки</b>\n${escapeHtml(String(deal.terms || "Не указаны"))}`;
}

function termsPrompt() {
  return [
    "<b>✏️ Условия сделки ⌵</b>",
    "",
    "✏️ Опишите условия сделки.",
    "",
    "┠ℹ️ Укажите:",
    "┠ что передается;",
    "┠ сроки;",
    "┠ что считается выполнением;",
    "┖ что считается нарушением.",
  ].join("\n");
}

function startMenu() {
  return { inline_keyboard: [[
    { text: "✦ Создать сделку", callback_data: "menu:new" },
  ], [
    { text: "▣ Мои сделки", callback_data: "menu:deals" },
    { text: "◈ Защита сделки", callback_data: "menu:help" },
  ], [{ text: "👤 Профиль", callback_data: "menu:profile" }]] };
}

function roleMenu() {
  return { inline_keyboard: [[
    { text: "Я покупатель", callback_data: "new:buyer" },
    { text: "Я продавец", callback_data: "new:seller" },
  ], [{ text: "Назад", callback_data: "menu:home" }]] };
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    awaiting_counterparty: "⌛ Ожидает вторую сторону",
    awaiting_payment: "◌ Ожидает оплату",
    paid: "◈ Заказ выполняется",
    awaiting_buyer_confirmation: "✓ Ожидает покупателя",
    payout_processing: "↻ Выплата обрабатывается",
    completed: "✦ Завершена",
    disputed: "⚑ Спор",
    cancelled: "− Отменена",
  };
  return labels[status] || status;
}

async function sendHome(botToken: string, chatId: number) {
  await telegram(botToken, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [
      "<b>FROG GARANT</b>",
      "<code>USDT SAFE DEALS · 3% SERVICE FEE</code>",
      "",
      "Безопасные сделки между покупателем и продавцом.",
      "Комиссия <b>3%</b> удерживается из выплаты продавцу.",
      "Деньги отправляются только после подтверждения покупателя.",
    ].join("\n"),
    reply_markup: startMenu(),
  });
}

async function upsertProfile(supabase: any, chatId: number, telegramUser: any) {
  const username = String(telegramUser?.username || telegramUser?.first_name || "Без имени").slice(0, 80);
  const { error } = await supabase.from("crypto_guarantor_profiles").upsert({ chat_id: chatId, telegram_username: username }, { onConflict: "chat_id" });
  if (error) throw error;
  const { error: reputationError } = await supabase.from("crypto_profile_reputation").upsert({ chat_id: chatId }, { onConflict: "chat_id", ignoreDuplicates: true });
  if (reputationError) throw reputationError;
}

async function sendProfile(supabase: any, botToken: string, chatId: number) {
  const [{ data: profile, error: profileError }, { data: reputation, error: reputationError }, { data: deals, error: dealsError }] = await Promise.all([
    supabase.from("crypto_guarantor_profiles").select("telegram_username, created_at").eq("chat_id", chatId).maybeSingle(),
    supabase.from("crypto_profile_reputation").select("positive_count, negative_count").eq("chat_id", chatId).maybeSingle(),
    supabase.from("crypto_deals").select("amount_usdt").eq("status", "completed").or(`buyer_chat_id.eq.${chatId},seller_chat_id.eq.${chatId}`),
  ]);
  if (profileError || reputationError || dealsError) throw profileError || reputationError || dealsError;
  const amount = (deals || []).reduce((sum: number, deal: any) => sum + Number(deal.amount_usdt || 0), 0);
  const positive = Number(reputation?.positive_count || 0);
  const negative = Number(reputation?.negative_count || 0);
  const reputationValue = positive - negative;
  const since = profile?.created_at
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Yekaterinburg" }).format(new Date(profile.created_at))
    : "сегодня";
  await telegram(botToken, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [
      "<b>👤 Профиль ⌵</b>",
      "",
      `┠👤 Имя: ${escapeHtml(String(profile?.telegram_username || "Без имени"))}`,
      `┠🆔 ID: <code>${chatId}</code>`,
      `┖📅 В системе с: ${since}`,
      "",
      `┠⭐ Репутация: ${reputationValue}`,
      `┠👍 Положительные: ${positive}`,
      `┖👎 Отрицательные: ${negative}`,
      "",
      `┠🤝 Сделки: ${(deals || []).length} шт`,
      `┖💵 Сумма сделок: ${amount.toFixed(2).replace(/\.00$/, "")} USDT`,
    ].join("\n"),
    reply_markup: { inline_keyboard: [[{ text: "Мои сделки", callback_data: "menu:deals" }], [{ text: "Главное меню", callback_data: "menu:home" }]] },
  });
}

function ratingMenu(dealId: string, targetChatId: number) {
  return { inline_keyboard: [[
    { text: "👍 Положительно", callback_data: `rate:${dealId}:${targetChatId}:1` },
    { text: "👎 Отрицательно", callback_data: `rate:${dealId}:${targetChatId}:-1` },
  ]] };
}

async function sendMyDeals(supabase: any, botToken: string, chatId: number) {
  const { data, error } = await supabase.from("crypto_deals")
    .select("id, deal_number, status, amount_usdt, buyer_chat_id, seller_chat_id, created_at")
    .or(`buyer_chat_id.eq.${chatId},seller_chat_id.eq.${chatId}`)
    .is("admin_archived_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  const deals = data || [];
  if (!deals.length) {
    return telegram(botToken, "sendMessage", { chat_id: chatId, text: "У вас пока нет сделок.", reply_markup: { inline_keyboard: [[{ text: "Создать сделку", callback_data: "menu:new" }]] } });
  }
  const participantIds = [...new Set(deals.flatMap((deal: any) => [deal.buyer_chat_id, deal.seller_chat_id]).filter(Boolean))];
  const { data: profiles, error: profilesError } = await supabase.from("crypto_guarantor_profiles").select("chat_id, telegram_username").in("chat_id", participantIds);
  if (profilesError) throw profilesError;
  const names = new Map((profiles || []).map((profile: any) => [Number(profile.chat_id), String(profile.telegram_username || "Без имени")]));
  const summary = deals.map((deal: any) => {
    const isBuyer = Number(deal.buyer_chat_id) === chatId;
    const counterpartId = isBuyer ? Number(deal.seller_chat_id) : Number(deal.buyer_chat_id);
    const counterpart = names.get(counterpartId) || "ожидает подключения";
    return `#${deal.deal_number} · <b>${deal.amount_usdt} USDT</b>\n${isBuyer ? "Продавец" : "Покупатель"}: ${escapeHtml(counterpart)}\n${statusLabel(deal.status)}`;
  }).join("\n\n");
  const buttons = deals.map((deal: any) => [{ text: `Открыть сделку #${deal.deal_number}`, callback_data: `deal:view:${deal.id}` }]);
  buttons.push([{ text: "Главное меню", callback_data: "menu:home" }]);
  await telegram(botToken, "sendMessage", { chat_id: chatId, text: `<b>МОИ СДЕЛКИ</b>\n<code>LIVE STATUS · USDT</code>\n\n${summary}`, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
}

async function sendDealDetails(supabase: any, botToken: string, chatId: number, dealId: string) {
  const { data: deal, error } = await supabase.from("crypto_deals").select("*").eq("id", dealId).is("admin_archived_at", null).maybeSingle();
  if (error || !deal || (deal.buyer_chat_id !== chatId && deal.seller_chat_id !== chatId)) return;
  const isBuyer = deal.buyer_chat_id === chatId;
  const { data: profiles, error: profilesError } = await supabase.from("crypto_guarantor_profiles").select("chat_id, telegram_username").in("chat_id", [deal.buyer_chat_id, deal.seller_chat_id].filter(Boolean));
  if (profilesError) throw profilesError;
  const names = new Map((profiles || []).map((profile: any) => [Number(profile.chat_id), String(profile.telegram_username || "Без имени")]));
  const buyerName = names.get(Number(deal.buyer_chat_id)) || "ожидает подключения";
  const sellerName = names.get(Number(deal.seller_chat_id)) || "ожидает подключения";
  const actions: any[] = [];
  if (deal.status === "awaiting_payment" && isBuyer) actions.push([{ text: "Оплатить USDT", callback_data: `pay:${deal.id}` }]);
  if (deal.status === "paid" && !isBuyer) actions.push([{ text: "Заказ выполнен", callback_data: `complete:${deal.id}` }]);
  if (deal.status === "awaiting_buyer_confirmation" && isBuyer) actions.push([{ text: "Подтвердить выполнение", callback_data: `confirm:${deal.id}` }]);
  if (["awaiting_payment", "paid", "awaiting_buyer_confirmation"].includes(deal.status)) actions.push([{ text: "Открыть спор", callback_data: `dispute:${deal.id}` }]);
  actions.push([{ text: "Мои сделки", callback_data: "menu:deals" }]);
  const nextStep = deal.status === "awaiting_payment" && isBuyer
    ? "Следующий шаг: оплатите счёт в USDT."
    : deal.status === "paid" && !isBuyer
      ? "Следующий шаг: выполните условия и отметьте заказ."
      : deal.status === "awaiting_buyer_confirmation" && isBuyer
        ? "Следующий шаг: проверьте результат и подтвердите сделку."
        : "Следите за статусом сделки в этом разделе.";
  await telegram(botToken, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `${dealText(deal)}\n\n👤 Покупатель: <b>${escapeHtml(buyerName)}</b>\n👤 Продавец: <b>${escapeHtml(sellerName)}</b>\n\n${dealTermsText(deal)}\n\nСтатус: <b>${statusLabel(deal.status)}</b>\nВаша роль: <b>${isBuyer ? "покупатель" : "продавец"}</b>\n\n<i>${nextStep}</i>`,
    reply_markup: { inline_keyboard: actions },
  });
}

async function setState(supabase: any, chatId: number, step: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from("crypto_bot_states").upsert({ chat_id: chatId, step, payload });
  if (error) throw error;
}

async function clearState(supabase: any, chatId: number) {
  const { error } = await supabase.from("crypto_bot_states").delete().eq("chat_id", chatId);
  if (error) throw error;
}

async function sendDealInvite(supabase: any, botToken: string, deal: any) {
  const botInfo = await telegram(botToken, "getMe", {});
  const botName = String(botInfo?.result?.username || "").replace(/^@/, "");
  if (!botName) throw new Error("Could not determine the bot username");
  const counterparty = deal.creator_role === "buyer" ? "продавцу" : "покупателю";
  await telegram(botToken, "sendMessage", {
    chat_id: deal.creator_chat_id,
    parse_mode: "HTML",
    text: `${dealText(deal)}\n\n${dealTermsText(deal)}\n\nОтправьте эту ссылку ${counterparty}:\nhttps://t.me/${botName}?start=deal_${deal.id}`,
  });
}

async function joinDeal(supabase: any, botToken: string, chatId: number, dealId: string) {
  const { data: deal, error } = await supabase.from("crypto_deals").select("*").eq("id", dealId).maybeSingle();
  if (error || !deal) throw error || new Error("Deal not found");
  if (deal.creator_chat_id === chatId) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Это ваша ссылка. Отправьте её второй стороне сделки." });
  if (deal.status !== "awaiting_counterparty") return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Эта сделка уже заполнена или закрыта." });

  const field = deal.creator_role === "buyer" ? "seller_chat_id" : "buyer_chat_id";
  const { data: joined, error: joinError } = await supabase.from("crypto_deals")
    .update({ [field]: chatId, status: "awaiting_payment" }).eq("id", dealId).eq("status", "awaiting_counterparty").select("*").maybeSingle();
  if (joinError || !joined) throw joinError || new Error("Deal was changed");
  await telegram(botToken, "sendMessage", { chat_id: joined.seller_chat_id, parse_mode: "HTML", text: `${dealText(joined)}\n\n${dealTermsText(joined)}\n\nПокупатель получит кнопку оплаты.` });
  await telegram(botToken, "sendMessage", {
    chat_id: joined.buyer_chat_id,
    parse_mode: "HTML",
    text: `${dealText(joined)}\n\n${dealTermsText(joined)}\n\nПеред оплатой: <b>3% от суммы удерживается как комиссия сервиса.</b>`,
    reply_markup: { inline_keyboard: [[{ text: "Оплатить USDT", callback_data: `pay:${joined.id}` }], [{ text: "Открыть спор", callback_data: `dispute:${joined.id}` }]] },
  });
}

async function createInvoice(supabase: any, botToken: string, cryptoToken: string, chatId: number, dealId: string) {
  const { data: deal, error } = await supabase.from("crypto_deals").select("*").eq("id", dealId).eq("buyer_chat_id", chatId).maybeSingle();
  if (error || !deal) throw error || new Error("Deal not found");
  if (deal.status !== "awaiting_payment") throw new Error("Payment is unavailable for this deal");
  if (!deal.crypto_invoice_id) {
    const invoice = await cryptoPay(cryptoToken, "createInvoice", {
      asset: "USDT", amount: String(deal.amount_usdt), description: `Safe deal #${deal.deal_number}`, payload: deal.id,
    });
    const { data: updated, error: updateError } = await supabase.from("crypto_deals")
      .update({ crypto_invoice_id: invoice.invoice_id, crypto_invoice_hash: invoice.hash }).eq("id", deal.id).is("crypto_invoice_id", null).select("*").single();
    if (updateError) throw updateError;
    return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Счёт создан. Оплата доступна по кнопке ниже.", reply_markup: { inline_keyboard: [[{ text: "Оплатить USDT", url: invoice.bot_invoice_url }]] } });
  }
  const invoice = await cryptoPay(cryptoToken, "getInvoices", { invoice_ids: String(deal.crypto_invoice_id) });
  const url = invoice.items?.[0]?.bot_invoice_url;
  if (!url) throw new Error("Invoice link not found");
  return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Счёт уже создан.", reply_markup: { inline_keyboard: [[{ text: "Оплатить USDT", url }]] } });
}

async function confirmPayout(supabase: any, botToken: string, cryptoToken: string, chatId: number, dealId: string) {
  const { data: claimed, error } = await supabase.rpc("claim_crypto_deal_payout", { p_deal_id: dealId, p_buyer_chat_id: chatId });
  const deal = Array.isArray(claimed) ? claimed[0] : claimed;
  if (error || !deal) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Подтверждение недоступно: сделка ещё не оплачена или уже обработана." });
  try {
    const transfer = await cryptoPay(cryptoToken, "transfer", { user_id: deal.seller_chat_id, asset: "USDT", amount: String(deal.seller_payout_usdt), spend_id: `deal-${dealId}-payout`, comment: `Выплата по сделке #${deal.deal_number}` });
    await supabase.from("crypto_deals").update({ status: "completed", payout_transfer_id: transfer.transfer_id, completed_at: new Date().toISOString() }).eq("id", dealId);
    await Promise.all([
      telegram(botToken, "sendMessage", { chat_id: chatId, text: `Сделка #${deal.deal_number} завершена. Выплата продавцу отправлена.` }),
      telegram(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: `Сделка #${deal.deal_number} завершена. Вам отправлено ${deal.seller_payout_usdt} USDT.` }),
      telegram(botToken, "sendMessage", { chat_id: chatId, text: "Оцените взаимодействие с продавцом.", reply_markup: ratingMenu(dealId, deal.seller_chat_id) }),
      telegram(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: "Оцените взаимодействие с покупателем.", reply_markup: ratingMenu(dealId, chatId) }),
    ]);
  } catch (payoutError) {
    await supabase.from("crypto_deals").update({ status: "paid", last_error: String(payoutError).slice(0, 500) }).eq("id", dealId);
    throw payoutError;
  }
}

async function markOrderCompleted(supabase: any, botToken: string, chatId: number, dealId: string) {
  const { data: deal, error } = await supabase.from("crypto_deals")
    .update({ status: "awaiting_buyer_confirmation" })
    .eq("id", dealId)
    .eq("seller_chat_id", chatId)
    .eq("status", "paid")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!deal) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Подтверждение недоступно: сделка ещё не оплачена или уже обработана." });
  await Promise.all([
    telegram(botToken, "sendMessage", { chat_id: chatId, text: `Вы отметили заказ по сделке #${deal.deal_number} как выполненный. Ожидайте подтверждения покупателя.` }),
    telegram(botToken, "sendMessage", {
      chat_id: deal.buyer_chat_id,
      text: `Продавец отметил заказ по сделке #${deal.deal_number} как выполненный. Проверьте результат и подтвердите выплату, либо откройте спор.`,
      reply_markup: { inline_keyboard: [[{ text: "Подтвердить выполнение", callback_data: `confirm:${deal.id}` }, { text: "Открыть спор", callback_data: `dispute:${deal.id}` }]] },
    }),
  ]);
}

async function verifyCryptoSignature(token: string, body: string, received: string | null) {
  if (!received) return false;
  const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey("raw", tokenHash, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== received.length) return false;
  return expected.split("").reduce((value, char, index) => value | (char.charCodeAt(0) ^ received.charCodeAt(index)), 0) === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false }, 405);
  try {
    const botToken = required("CRYPTO_GUARANTOR_BOT_TOKEN");
    const cryptoToken = required("CRYPTO_PAY_API_TOKEN");
    const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"));
    const url = new URL(request.url);
    const rawBody = await request.text();

    if (url.searchParams.get("source") === "crypto") {
      // Crypto Pay signs the original body with the app-token-derived HMAC.
      // The public callback URL is therefore safe without exposing a token in it.
      if (!await verifyCryptoSignature(cryptoToken, rawBody, request.headers.get("crypto-pay-api-signature"))) return json({ ok: false }, 401);
      const update = JSON.parse(rawBody);
      if (update.update_type !== "invoice_paid") return json({ ok: true });
      const invoice = update.payload;
      const { data: deal, error } = await supabase.from("crypto_deals").update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("crypto_invoice_id", invoice.invoice_id).eq("status", "awaiting_payment").select("*").maybeSingle();
      if (error) throw error;
      if (deal) await Promise.all([
        telegram(botToken, "sendMessage", { chat_id: deal.buyer_chat_id, text: `Оплата по сделке #${deal.deal_number} получена. Продавец выполнит заказ и отметит его сдачу в боте.` }),
        telegram(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: `Оплата по сделке #${deal.deal_number} получена. Когда заказ будет выполнен, нажмите кнопку ниже.`, reply_markup: { inline_keyboard: [[{ text: "Заказ выполнен", callback_data: `complete:${deal.id}` }, { text: "Открыть спор", callback_data: `dispute:${deal.id}` }]] } }),
      ]);
      return json({ ok: true });
    }

    if (request.headers.get("x-telegram-bot-api-secret-token") !== required("CRYPTO_GUARANTOR_TELEGRAM_SECRET")) return json({ ok: false }, 401);
    const update = JSON.parse(rawBody);
    const message = update.message;
    const callback = update.callback_query;
    const chatId = Number(message?.chat?.id || callback?.message?.chat?.id);
    if (!Number.isSafeInteger(chatId)) return json({ ok: true });
    await upsertProfile(supabase, chatId, message?.from || callback?.from);
    if (callback) await telegram(botToken, "answerCallbackQuery", { callback_query_id: callback.id });
    const text = String(message?.text || "");
    if (text.startsWith("/start")) {
      const dealId = text.split(/\s+/)[1]?.replace("deal_", "");
      if (dealId) await joinDeal(supabase, botToken, chatId, dealId);
      else await sendHome(botToken, chatId);
      return json({ ok: true });
    }
    if (text === "/deals") {
      await sendMyDeals(supabase, botToken, chatId);
      return json({ ok: true });
    }
    if (callback?.data === "menu:home") {
      await sendHome(botToken, chatId);
      return json({ ok: true });
    }
    if (callback?.data === "menu:new") {
      await telegram(botToken, "sendMessage", { chat_id: chatId, text: "Кем вы являетесь в этой сделке?", reply_markup: roleMenu() });
      return json({ ok: true });
    }
    if (callback?.data === "menu:deals") {
      await sendMyDeals(supabase, botToken, chatId);
      return json({ ok: true });
    }
    if (callback?.data === "menu:profile") {
      await sendProfile(supabase, botToken, chatId);
      return json({ ok: true });
    }
    if (callback?.data === "menu:help") {
      await telegram(botToken, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "<b>Защита сделки</b>\n\n1. Создайте сделку, укажите сумму и условия.\n2. Отправьте ссылку второй стороне.\n3. Покупатель оплачивает USDT.\n4. Продавец отмечает выполнение условий.\n5. Покупатель подтверждает результат, после чего отправляется выплата.\n\nПри споре выплата останавливается до решения администратора." });
      return json({ ok: true });
    }
    if (callback?.data?.startsWith("deal:view:")) {
      await sendDealDetails(supabase, botToken, chatId, callback.data.slice(10));
      return json({ ok: true });
    }
    const ratingMatch = String(callback?.data || "").match(/^rate:([0-9a-f-]{36}):(\d+):(-?1)$/i);
    if (callback && ratingMatch) {
      const [, dealId, targetId, value] = ratingMatch;
      const { data: accepted, error } = await supabase.rpc("submit_crypto_deal_rating", {
        p_deal_id: dealId,
        p_rater_chat_id: chatId,
        p_target_chat_id: Number(targetId),
        p_value: Number(value),
      });
      if (error) throw error;
      await telegram(botToken, "answerCallbackQuery", { callback_query_id: callback.id, text: accepted ? "Оценка сохранена" : "Оценка уже поставлена или сделка не завершена", show_alert: !accepted });
      return json({ ok: true });
    }
    if (callback?.data?.startsWith("new:")) {
      const role = callback.data.split(":")[1];
      await setState(supabase, chatId, "amount", { role });
      await telegram(botToken, "sendMessage", { chat_id: chatId, text: "Введите сумму сделки в USDT, например: 100" });
      return json({ ok: true });
    }
    if (callback?.data?.startsWith("pay:")) await createInvoice(supabase, botToken, cryptoToken, chatId, callback.data.slice(4));
    else if (callback?.data?.startsWith("complete:")) await markOrderCompleted(supabase, botToken, chatId, callback.data.slice(9));
    else if (callback?.data?.startsWith("confirm:")) await confirmPayout(supabase, botToken, cryptoToken, chatId, callback.data.slice(8));
    else if (callback?.data?.startsWith("dispute:")) {
      const dealId = callback.data.slice(8);
      const { data: currentDeal, error: currentDealError } = await supabase.from("crypto_deals").select("*").eq("id", dealId).maybeSingle();
      if (currentDealError) throw currentDealError;
      if (!currentDeal || (currentDeal.buyer_chat_id !== chatId && currentDeal.seller_chat_id !== chatId)) {
        return json({ ok: true });
      }
      const { data: deal, error: disputeError } = await supabase.from("crypto_deals").update({ status: "disputed" }).eq("id", dealId).in("status", ["awaiting_payment", "paid", "awaiting_buyer_confirmation"]).select("*").maybeSingle();
      if (disputeError) throw disputeError;
      if (deal) {
        await Promise.all([
          telegram(botToken, "sendMessage", {
            chat_id: chatId,
            text: `Спор по сделке #${deal.deal_number} открыт. Выплата остановлена. Напишите администратору, чтобы разобраться в ситуации.`,
            reply_markup: adminContactMenu(),
          }),
          telegram(botToken, "sendMessage", {
            chat_id: guarantorAdminChatId(),
            text: `Спор по сделке #${deal.deal_number}.\nПокупатель: ${deal.buyer_chat_id}\nПродавец: ${deal.seller_chat_id}\nВыплата остановлена.`,
            reply_markup: {
              inline_keyboard: [[
                { text: "Открыть покупателя", url: `tg://user?id=${deal.buyer_chat_id}` },
                { text: "Открыть продавца", url: `tg://user?id=${deal.seller_chat_id}` },
              ]],
            },
          }),
        ]);
      }
    } else if (message?.text) {
      const { data: state } = await supabase.from("crypto_bot_states").select("*").eq("chat_id", chatId).maybeSingle();
      if (state?.step === "amount") {
        const amount = parseUsdt(text.trim());
        if (!amount) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Введите корректную сумму USDT, например: 100 или 25.50" });
        const fee = (amount * BigInt(feeBasisPoints) + 9_999n) / 10_000n;
        const payout = amount - fee;
        if (payout <= 0n) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Сумма слишком мала для создания сделки." });
        await setState(supabase, chatId, "terms", { role: state.payload.role, amount_usdt: formatUsdt(amount), fee_usdt: formatUsdt(fee), seller_payout_usdt: formatUsdt(payout) });
        return telegram(botToken, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: termsPrompt() });
      }
      if (state?.step !== "terms") return json({ ok: true });
      const terms = text.trim().replace(/\s+/g, " ").slice(0, 2000);
      if (terms.length < 12) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Опишите условия подробнее: минимум 12 символов." });
      const role = state.payload.role;
      const { data: deal, error } = await supabase.from("crypto_deals").insert({ creator_chat_id: chatId, creator_role: role, buyer_chat_id: role === "buyer" ? chatId : null, seller_chat_id: role === "seller" ? chatId : null, amount_usdt: state.payload.amount_usdt, fee_usdt: state.payload.fee_usdt, seller_payout_usdt: state.payload.seller_payout_usdt, terms }).select("*").single();
      if (error) throw error;
      await clearState(supabase, chatId);
      await sendDealInvite(supabase, botToken, deal);
    }
    return json({ ok: true });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
