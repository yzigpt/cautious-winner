import {
  SUPABASE_ADMIN_EMAIL,
  getSupabase,
  getSupabaseConfigError,
  isSupabaseConfigured,
} from "./supabase-client.js?v=20260710-3";

const REVIEWS_TABLE = "reviews";
const REQUESTS_TABLE = "project_requests";

function ensureConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(getSupabaseConfigError());
  }

  return getSupabase();
}

async function getAdminProfile() {
  const supabase = ensureConfigured();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error("Не удалось получить данные администратора.");
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("admin_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Не удалось проверить доступ к кабинету.");
  }

  if (!data) {
    return null;
  }

  return {
    id: user.id,
    username: data.display_name || user.email || "Admin",
    email: user.email || SUPABASE_ADMIN_EMAIL,
  };
}

async function requireAdmin() {
  const admin = await getAdminProfile();
  if (!admin) {
    throw new Error("Требуется вход администратора.");
  }
  return admin;
}

export async function getAdminStatus() {
  const admin = await getAdminProfile().catch(() => null);
  return {
    needsSetup: false,
    authenticated: Boolean(admin),
  };
}

export async function getAdminMe() {
  return {
    admin: await getAdminProfile(),
    needsSetup: false,
  };
}

export async function adminSetup() {
  throw new Error(
    "Создание администратора через сайт отключено. Создайте пользователя в Supabase Auth."
  );
}

export async function adminLogin(body = {}) {
  const supabase = ensureConfigured();
  const email = String(body.email || body.username || SUPABASE_ADMIN_EMAIL).trim();
  const password = String(body.password || "");

  if (!email || email === "admin@example.com") {
    throw new Error("Укажите email администратора в supabase-config.js.");
  }

  if (!password) {
    throw new Error("Введите пароль администратора.");
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error("Неверный email или пароль администратора.");
  }

  const admin = await getAdminProfile();
  if (!admin) {
    await supabase.auth.signOut();
    throw new Error("У этой учётной записи нет доступа к кабинету.");
  }

  return { ok: true, admin };
}

export async function adminLogout() {
  const supabase = ensureConfigured();
  await supabase.auth.signOut();
  return { ok: true };
}

export async function getOverview() {
  await requireAdmin();
  const supabase = ensureConfigured();

  const [{ count: total, error: totalError }, { count: unread, error: unreadError }, { count: reviews, error: reviewsError }] =
    await Promise.all([
      supabase.from(REQUESTS_TABLE).select("*", { count: "exact", head: true }),
      supabase
        .from(REQUESTS_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("status", "new"),
      supabase.from(REVIEWS_TABLE).select("*", { count: "exact", head: true }),
    ]);

  if (totalError || unreadError || reviewsError) {
    throw new Error("Не удалось загрузить обзор кабинета.");
  }

  return {
    conversations: total || 0,
    unread: unread || 0,
    reviews: reviews || 0,
    avgRating: "0.0",
  };
}

export async function listProjectRequests(filter = "all") {
  await requireAdmin();
  const supabase = ensureConfigured();
  let query = supabase
    .from(REQUESTS_TABLE)
    .select("id, name, text, status, admin_reply, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (filter === "new" || filter === "answered") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Не удалось загрузить заявки.");
  }

  return {
    requests: data || [],
  };
}

export async function updateProjectRequest(id, body = {}) {
  await requireAdmin();
  const supabase = ensureConfigured();
  const payload = {
    status: body.status === "answered" ? "answered" : "new",
    admin_reply: String(body.admin_reply || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(REQUESTS_TABLE)
    .update(payload)
    .eq("id", id)
    .select("id, name, text, status, admin_reply, created_at, updated_at")
    .single();

  if (error) {
    throw new Error("Не удалось обновить заявку.");
  }

  return { request: data };
}

export async function listAdminReviews() {
  await requireAdmin();
  const supabase = ensureConfigured();
  const { data, error } = await supabase
    .from(REVIEWS_TABLE)
    .select("id, name, text, rating, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Не удалось загрузить отзывы.");
  }

  return { reviews: data || [] };
}

export async function updateAdminReview(id, body = {}) {
  await requireAdmin();
  const supabase = ensureConfigured();
  const payload = {
    text: String(body.text || "").trim(),
    rating: Number(body.rating || 0),
    updated_at: new Date().toISOString(),
  };

  if (!payload.text) {
    throw new Error("Текст отзыва не может быть пустым.");
  }

  if (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
    throw new Error("Оценка должна быть от 1 до 5.");
  }

  const { error } = await supabase.from(REVIEWS_TABLE).update(payload).eq("id", id);
  if (error) {
    throw new Error("Не удалось сохранить отзыв.");
  }

  return { ok: true };
}

export async function deleteAdminReview(id) {
  await requireAdmin();
  const supabase = ensureConfigured();
  const { error } = await supabase.from(REVIEWS_TABLE).delete().eq("id", id);
  if (error) {
    throw new Error("Не удалось удалить отзыв.");
  }
  return { ok: true };
}

export async function getConversationMessages() {
  return { messages: [] };
}

export async function listConversations() {
  const payload = await listProjectRequests("all");
  return {
    conversations: (payload.requests || []).map((item) => ({
      id: item.id,
      visitor_name: item.name,
      last_message: item.text,
      status: item.status,
      updated_at: item.updated_at,
      created_at: item.created_at,
    })),
  };
}

export async function sendAdminMessage(id, body = {}) {
  return updateProjectRequest(id, {
    status: "answered",
    admin_reply: body.text,
  });
}

export async function changeAdminPassword() {
  throw new Error(
    "Смена пароля теперь делается в Supabase Auth, а не через этот статический сайт."
  );
}
