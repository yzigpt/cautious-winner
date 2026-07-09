import {
  adminLogin,
  adminLogout,
  getAdminMe,
  getAdminStatus,
  getOverview,
  getConversationMessages,
  listConversations,
  sendAdminMessage,
} from "./admin-api.js";
import { escapeHtml } from "./storage.js";

const gate = document.getElementById("admin-gate");
const gateText = document.getElementById("admin-gate-text");
const adminLoginForm = document.getElementById("admin-login-form");
const adminLoginPassword = document.getElementById("admin-login-password");
const adminUserCard = document.getElementById("admin-user-card");
const adminLogoutBtn = document.getElementById("admin-logout-btn");
const cabinetRefreshBtn = document.getElementById("cabinet-refresh-btn");
const filterButtons = Array.from(document.querySelectorAll("[data-conversation-filter]"));
const statRequests = document.getElementById("stat-requests");
const statUnread = document.getElementById("stat-unread");
const statAnswered = document.getElementById("stat-answered");
const messageStatus = document.getElementById("cabinet-message-status");
const conversationList = document.getElementById("conversation-list");
const threadFeed = document.getElementById("cabinet-thread");
const replyForm = document.getElementById("reply-form");
const replyText = document.getElementById("reply-text");

let admin = null;
let conversationState = [];
let selectedConversationId = null;
let refreshTimer = null;
let activeFilter = "all";

function setGateMessage(message) {
  gateText.textContent = message;
}

function openGate() {
  gate.classList.add("is-open");
  gate.setAttribute("aria-hidden", "false");
}

function closeGate() {
  gate.classList.remove("is-open");
  gate.setAttribute("aria-hidden", "true");
}

function renderAdminUser() {
  if (!admin) {
    adminUserCard.innerHTML = `
      <div class="sidebar-user__name">Гость</div>
      <div class="sidebar-user__meta">Кабинет защищен паролем</div>
    `;
    return;
  }

  adminUserCard.innerHTML = `
    <div class="sidebar-user__name">👋 ${escapeHtml(admin.username)}</div>
    <div class="sidebar-user__meta">Доступ подтвержден</div>
  `;
}

function renderStats(overview) {
  statRequests.textContent = String(overview.conversations || 0);
  statUnread.textContent = String(overview.unread || 0);
  statAnswered.textContent = String(
    Math.max(0, (overview.conversations || 0) - (overview.unread || 0))
  );
}

function getFilteredConversations() {
  if (activeFilter === "all") return conversationState;
  if (activeFilter === "answered") {
    return conversationState.filter((item) => item.status === "answered");
  }
  return conversationState.filter((item) => item.status === "new");
}

function renderConversationList() {
  const filtered = getFilteredConversations();

  filterButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.conversationFilter === activeFilter
    );
  });

  if (!filtered.length) {
    conversationList.innerHTML = `
      <tr class="conversation-row conversation-row--empty">
        <td colspan="3">Пока нет заявок в этом фильтре. Когда покупатель напишет сообщение, оно появится здесь.</td>
      </tr>
    `;
    threadFeed.innerHTML = "";
    messageStatus.textContent = "Нет активных заявок.";
    return;
  }

  if (!selectedConversationId || !filtered.some((item) => item.id === selectedConversationId)) {
    selectedConversationId = filtered[0].id;
  }

  conversationList.innerHTML = filtered
    .map(
      (conversation) => `
        <tr class="conversation-row ${conversation.id === selectedConversationId ? "is-active" : ""}" data-conversation-id="${escapeHtml(conversation.id)}">
          <td>
            <div class="conversation-cell__main">
              <strong>${escapeHtml(conversation.visitor_name)}</strong>
              <small>${new Date(conversation.updated_at).toLocaleString("ru-RU")}</small>
            </div>
          </td>
          <td>
            <span class="conversation-preview">${escapeHtml(
              conversation.last_message || "Нет сообщения"
            )}</span>
          </td>
          <td>
            <span class="status-pill status-pill--${
              conversation.status === "answered" ? "answered" : "new"
            }">
              ${conversation.status === "answered" ? "Ответили" : "Новая"}
            </span>
          </td>
        </tr>
      `
    )
    .join("");

  renderThread();
}

async function renderThread() {
  if (!selectedConversationId) return;

  try {
    const payload = await getConversationMessages(selectedConversationId);
    const messages = payload.messages || [];

    if (!messages.length) {
      threadFeed.innerHTML = `<div class="chat-bubble">Пустой диалог.</div>`;
      messageStatus.textContent = "Диалог открыт.";
      return;
    }

    const conversation = conversationState.find((item) => item.id === selectedConversationId);
    messageStatus.textContent = conversation
      ? `Заявка от ${escapeHtml(conversation.visitor_name)}.`
      : "Диалог открыт.";

    threadFeed.innerHTML = messages
      .map(
        (message) => `
          <div class="chat-bubble ${message.sender === "admin" ? "chat-bubble--me" : ""}">
            <div class="chat-bubble__meta">
              <span>${escapeHtml(message.sender_name)}</span>
              <span>${new Date(message.created_at).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              })}</span>
            </div>
            <div>${escapeHtml(message.text)}</div>
          </div>
        `
      )
      .join("");
  } catch (error) {
    messageStatus.textContent =
      error.message || "Не удалось загрузить сообщения.";
  }
}

async function refreshDashboard() {
  const overview = await getOverview();
  conversationState = (await listConversations()).conversations || [];

  if (
    activeFilter === "answered" &&
    !conversationState.some((item) => item.status === "answered")
  ) {
    activeFilter = "all";
  }

  renderStats(overview);
  renderConversationList();
}

async function bootstrapAuth() {
  const status = await getAdminStatus();

  if (status.authenticated) {
    admin = (await getAdminMe()).admin;
    closeGate();
    renderAdminUser();
    await refreshDashboard();
    startAutoRefresh();
    return;
  }

  openGate();
  setGateMessage("Введите пароль администратора для входа в кабинет заявок.");
  renderAdminUser();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);

  refreshTimer = setInterval(() => {
    if (admin) {
      refreshDashboard().catch(() => {});
    }
  }, 8000);
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await adminLogin({
      username: "admin",
      password: adminLoginPassword.value,
    });
    admin = (await getAdminMe()).admin;
    closeGate();
    renderAdminUser();
    await refreshDashboard();
    startAutoRefresh();
  } catch (error) {
    setGateMessage(error.message || "Не удалось войти.");
  }
});

adminLogoutBtn.addEventListener("click", async () => {
  await adminLogout();
  admin = null;
  conversationState = [];
  closeGate();
  openGate();
  renderAdminUser();
  setGateMessage("Сессия завершена. Введите пароль снова.");
});

cabinetRefreshBtn.addEventListener("click", async () => {
  if (!admin) return;
  await refreshDashboard();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.conversationFilter;
    selectedConversationId = null;
    renderConversationList();
  });
});

conversationList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-conversation-id]");
  if (!item) return;
  selectedConversationId = item.dataset.conversationId;
  renderConversationList();
});

replyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedConversationId) return;

  const text = replyText.value.trim();
  if (!text) return;

  await sendAdminMessage(selectedConversationId, { text });
  replyText.value = "";
  await refreshDashboard();
});

await bootstrapAuth();
