import {
  getSupabase,
  getSupabaseConfigError,
  isSupabaseConfigured,
} from "./supabase-client.js?v=20260710-telegram";
import { TELEGRAM_REQUEST_FUNCTION_ENABLED } from "./supabase-config.js";

const REVIEWS_TABLE = "reviews";
const REQUESTS_TABLE = "project_requests";

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }

  return getSupabase();
}

function normalizeReview(row) {
  return {
    id: row.id,
    name: row.name,
    text: row.text,
    rating: row.rating,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getVisitor() {
  return null;
}

export async function getPublicReviews(limit = 8) {
  const supabase = ensureConfigured();
  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .select("id, name, text, rating, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error("Не удалось загрузить отзывы из Supabase.");
  }

  return (data || []).map(normalizeReview);
}

export async function createReview({ name, text, rating }) {
  const supabase = ensureConfigured();
  const payload = {
    name: String(name || "Гость").trim() || "Гость",
    text: String(text || "").trim(),
    rating: Number(rating || 0),
  };

  if (!payload.text) {
    throw new Error("Введите текст отзыва.");
  }

  if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
    throw new Error("Оценка должна быть от 1 до 5.");
  }

  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .insert(payload)
    .select("id, name, text, rating, created_at, updated_at")
    .single();

  if (error) {
    throw new Error("Не удалось сохранить отзыв.");
  }

  return normalizeReview(data);
}

export async function sendMessage({ name, text }) {
  const supabase = ensureConfigured();
  const payload = {
    name: String(name || "").trim(),
    text: String(text || "").trim(),
  };

  if (!payload.name || !payload.text) {
    throw new Error("Заполните имя и сообщение.");
  }

  if (TELEGRAM_REQUEST_FUNCTION_ENABLED) {
    const { data: telegramResult, error: telegramError } = await supabase.functions.invoke(
      "telegram-request",
      { body: payload }
    );

    if (telegramError || !telegramResult?.ok) {
      throw new Error("Не удалось отправить заявку.");
    }

    return {
      ok: true,
      notificationSent: Boolean(telegramResult.notificationSent),
    };
  }

  // Visitors may create requests but must never be able to read them back.
  // Do not ask Supabase for a returned row here: that would require public
  // SELECT access and exposes buyer requests.
  const { error } = await supabase.from(REQUESTS_TABLE).insert(payload);

  if (error) {
    throw new Error("Не удалось отправить заявку.");
  }

  return { ok: true };
}
