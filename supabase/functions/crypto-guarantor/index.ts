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

function dealText(deal: any) {
  return [
    `<b>Сделка #${deal.deal_number}</b>`,
    `Сумма: <b>${deal.amount_usdt} USDT</b>`,
    `Комиссия сервиса: <b>${deal.fee_usdt} USDT (3%)</b>`,
    `Продавец получит: <b>${deal.seller_payout_usdt} USDT</b>`,
  ].join("\n");
}

function startMenu() {
  return { inline_keyboard: [[
    { text: "Я покупатель", callback_data: "new:buyer" },
    { text: "Я продавец", callback_data: "new:seller" },
  ]] };
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
    text: `${dealText(deal)}\n\nОтправьте эту ссылку ${counterparty}:\nhttps://t.me/${botName}?start=deal_${deal.id}`,
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
  await telegram(botToken, "sendMessage", { chat_id: joined.seller_chat_id, parse_mode: "HTML", text: `${dealText(joined)}\n\nПокупатель получит кнопку оплаты.` });
  await telegram(botToken, "sendMessage", {
    chat_id: joined.buyer_chat_id,
    parse_mode: "HTML",
    text: `${dealText(joined)}\n\nПеред оплатой: <b>3% от суммы удерживается как комиссия сервиса.</b>`,
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
    ]);
  } catch (payoutError) {
    await supabase.from("crypto_deals").update({ status: "paid", last_error: String(payoutError).slice(0, 500) }).eq("id", dealId);
    throw payoutError;
  }
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
        telegram(botToken, "sendMessage", { chat_id: deal.buyer_chat_id, text: `Оплата по сделке #${deal.deal_number} получена. Подтвердите выполнение, когда всё будет готово.`, reply_markup: { inline_keyboard: [[{ text: "Подтвердить выполнение", callback_data: `confirm:${deal.id}` }, { text: "Открыть спор", callback_data: `dispute:${deal.id}` }]] } }),
        telegram(botToken, "sendMessage", { chat_id: deal.seller_chat_id, text: `Оплата по сделке #${deal.deal_number} получена. Ожидайте подтверждения покупателя.` }),
      ]);
      return json({ ok: true });
    }

    if (request.headers.get("x-telegram-bot-api-secret-token") !== required("CRYPTO_GUARANTOR_TELEGRAM_SECRET")) return json({ ok: false }, 401);
    const update = JSON.parse(rawBody);
    const message = update.message;
    const callback = update.callback_query;
    const chatId = Number(message?.chat?.id || callback?.message?.chat?.id);
    if (!Number.isSafeInteger(chatId)) return json({ ok: true });
    if (callback) await telegram(botToken, "answerCallbackQuery", { callback_query_id: callback.id });
    const text = String(message?.text || "");
    if (text.startsWith("/start")) {
      const dealId = text.split(/\s+/)[1]?.replace("deal_", "");
      if (dealId) await joinDeal(supabase, botToken, chatId, dealId);
      else await telegram(botToken, "sendMessage", { chat_id: chatId, text: "Создайте сделку и пригласите вторую сторону. Комиссия сервиса составляет 3% и удерживается из выплаты продавцу.", reply_markup: startMenu() });
      return json({ ok: true });
    }
    if (callback?.data?.startsWith("new:")) {
      const role = callback.data.split(":")[1];
      await setState(supabase, chatId, "amount", { role });
      await telegram(botToken, "sendMessage", { chat_id: chatId, text: "Введите сумму сделки в USDT, например: 100" });
      return json({ ok: true });
    }
    if (callback?.data?.startsWith("pay:")) await createInvoice(supabase, botToken, cryptoToken, chatId, callback.data.slice(4));
    else if (callback?.data?.startsWith("confirm:")) await confirmPayout(supabase, botToken, cryptoToken, chatId, callback.data.slice(8));
    else if (callback?.data?.startsWith("dispute:")) {
      const dealId = callback.data.slice(8);
      const { data: currentDeal, error: currentDealError } = await supabase.from("crypto_deals").select("*").eq("id", dealId).maybeSingle();
      if (currentDealError) throw currentDealError;
      if (!currentDeal || (currentDeal.buyer_chat_id !== chatId && currentDeal.seller_chat_id !== chatId)) {
        return json({ ok: true });
      }
      const { data: deal, error: disputeError } = await supabase.from("crypto_deals").update({ status: "disputed" }).eq("id", dealId).in("status", ["awaiting_payment", "paid"]).select("*").maybeSingle();
      if (disputeError) throw disputeError;
      if (deal) await telegram(botToken, "sendMessage", { chat_id: guarantorAdminChatId(), text: `Спор по сделке #${deal.deal_number}. Выплата остановлена.` });
    } else if (message?.text) {
      const { data: state } = await supabase.from("crypto_bot_states").select("*").eq("chat_id", chatId).maybeSingle();
      if (state?.step !== "amount") return json({ ok: true });
      const amount = parseUsdt(text.trim());
      if (!amount) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Введите корректную сумму USDT, например: 100 или 25.50" });
      const fee = (amount * BigInt(feeBasisPoints) + 9_999n) / 10_000n;
      const payout = amount - fee;
      if (payout <= 0n) return telegram(botToken, "sendMessage", { chat_id: chatId, text: "Сумма слишком мала для создания сделки." });
      const role = state.payload.role;
      const { data: deal, error } = await supabase.from("crypto_deals").insert({ creator_chat_id: chatId, creator_role: role, buyer_chat_id: role === "buyer" ? chatId : null, seller_chat_id: role === "seller" ? chatId : null, amount_usdt: formatUsdt(amount), fee_usdt: formatUsdt(fee), seller_payout_usdt: formatUsdt(payout) }).select("*").single();
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
