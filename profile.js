import { getCurrentSession, signIn, signOut, signUp } from "./auth.js";
import { getSupabase } from "./supabase-client.js?v=20260710-account";
import { escapeHtml } from "./storage.js";

const authPanel = document.getElementById("auth-panel");
const profilePanel = document.getElementById("profile-panel");
const authStatus = document.getElementById("auth-status");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const requestList = document.getElementById("my-requests");
let realtimeChannel = null;

function statusLabel(status) {
  if (status === "completed") return "\u{1F3C1} \u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430";
  if (status === "answered") return "✅ Принята";
  if (status === "rejected") return "🚫 Отклонена";
  return "🆕 Новая";
}

async function loadRequests(userId) {
  const { data, error } = await getSupabase()
    .from("project_requests")
    .select("request_number, text, status, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  requestList.innerHTML = (data || []).length
    ? data.map((item) => `<article class="profile-request"><div><strong>Заявка №${item.request_number}</strong><p>${escapeHtml(item.text)}</p><small>${new Date(item.created_at).toLocaleString("ru-RU")}</small></div><span class="profile-request__status profile-request__status--${item.status}">${statusLabel(item.status)}</span></article>`).join("")
    : '<p class="section-copy">У вас пока нет заявок.</p>';
}

async function showProfile(session) {
  const user = session.user;
  authPanel.hidden = true;
  profilePanel.hidden = false;
  profileName.textContent = user.user_metadata?.display_name || "Пользователь";
  profileEmail.textContent = user.email || "";
  await loadRequests(user.id);
  realtimeChannel?.unsubscribe();
  realtimeChannel = getSupabase()
    .channel(`my-requests-${user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "project_requests", filter: `user_id=eq.${user.id}` }, () => loadRequests(user.id).catch(() => {}))
    .subscribe();
}

async function refreshView() {
  const session = await getCurrentSession();
  if (session) return showProfile(session);
  realtimeChannel?.unsubscribe();
  authPanel.hidden = false;
  profilePanel.hidden = true;
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await signIn({ email: document.getElementById("login-email").value.trim(), password: document.getElementById("login-password").value });
    authStatus.textContent = "Вход выполнен.";
    await refreshView();
  } catch (error) { authStatus.textContent = error.message || "Не удалось войти."; }
});

document.getElementById("signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await signUp({ name: document.getElementById("signup-name").value.trim(), email: document.getElementById("signup-email").value.trim(), password: document.getElementById("signup-password").value });
    authStatus.textContent = data.session ? "Аккаунт создан." : "Проверьте email и подтвердите регистрацию, затем войдите.";
    await refreshView();
  } catch (error) { authStatus.textContent = error.message || "Не удалось создать аккаунт."; }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  await signOut();
  authStatus.textContent = "Вы вышли из аккаунта.";
  await refreshView();
});

await refreshView();
