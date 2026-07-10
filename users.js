import { getCurrentSession } from "./auth.js";
import { getSupabase } from "./supabase-client.js";
import { escapeHtml } from "./storage.js";

const status = document.getElementById("users-status");
const list = document.getElementById("users-list");
const refreshButton = document.getElementById("users-refresh");

function label(value) {
  return value === "blocked" ? "Заблокирован" : value === "frozen" ? "Заморожен" : "Активен";
}

async function callAdmin(body) {
  const { data, error } = await getSupabase().functions.invoke("admin-users", { body });
  if (error || !data?.ok) throw new Error(data?.error || error?.message || "Нет доступа к пользователям.");
  return data;
}

function render(users) {
  list.innerHTML = users.length ? users.map((user) => `
    <article class="user-row" data-account-status="${user.account_status}" data-ip-status="${user.ip_status}">
      <div class="user-row__identity"><strong>${escapeHtml(user.name || "Без имени")}</strong><span>${escapeHtml(user.email)}</span><small>Создан: ${new Date(user.created_at).toLocaleString("ru-RU")}</small></div>
      <div class="user-row__state"><span class="access-pill access-pill--${user.account_status}">Аккаунт: ${label(user.account_status)}</span><span class="access-pill access-pill--${user.ip_status}">IP: ${label(user.ip_status)}</span><small>${escapeHtml(user.ip_fingerprint)}</small></div>
      <div class="user-row__actions">
        <button type="button" data-user="${user.id}" data-account="active">Активировать</button>
        <button type="button" data-user="${user.id}" data-account="frozen">Заморозить</button>
        <button type="button" data-user="${user.id}" data-account="blocked">Блокировать</button>
        <button type="button" data-user="${user.id}" data-ip="active" ${user.ip_fingerprint === "No activity yet" ? "disabled" : ""}>Активировать IP</button>
        <button type="button" data-user="${user.id}" data-ip="frozen" ${user.ip_fingerprint === "No activity yet" ? "disabled" : ""}>Заморозить IP</button>
        <button type="button" data-user="${user.id}" data-ip="blocked" ${user.ip_fingerprint === "No activity yet" ? "disabled" : ""}>Блокировать IP</button>
      </div>
    </article>`).join("") : '<p class="section-copy">Пользователей пока нет.</p>';
}

async function loadUsers() {
  const session = await getCurrentSession();
  if (!session) throw new Error("Войдите в аккаунт администратора.");
  status.textContent = "Загружаем пользователей...";
  const data = await callAdmin({ action: "list" });
  render(data.users);
  status.textContent = `Пользователей: ${data.users.length}`;
}

list.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-user]");
  if (!button || button.disabled) return;
  try {
    button.disabled = true;
    const row = button.closest(".user-row");
    const accountStatus = button.dataset.account || row.dataset.accountStatus || "active";
    const ipStatus = button.dataset.ip || row.dataset.ipStatus || "active";
    await callAdmin({ action: "update", user_id: button.dataset.user, account_status: accountStatus, ip_status: ipStatus });
    await loadUsers();
  } catch (error) {
    status.textContent = error.message || "Не удалось обновить доступ.";
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", () => loadUsers().catch((error) => { status.textContent = error.message || "Нет доступа к пользователям."; }));
loadUsers().catch((error) => { status.textContent = error.message || "Нет доступа к пользователям."; });
