import {
  SUPABASE_ADMIN_EMAIL,
  adminLogin,
  adminLogout,
  deleteAdminReview,
  getAdminMe,
  getAdminStatus,
  getOverview,
  listAdminReviews,
  listProjectRequests,
  updateAdminReview,
  updateProjectRequest,
} from "./admin-api.js?v=20260710-3";
import { escapeHtml, starString } from "./storage.js?v=20260710-3";

const gate = document.getElementById("admin-gate");
const gateText = document.getElementById("admin-gate-text");
const adminEmailHint = document.getElementById("admin-email-hint");
const adminLoginForm = document.getElementById("admin-login-form");
const adminLoginPassword = document.getElementById("admin-login-password");
const adminUserCard = document.getElementById("admin-user-card");
const adminLogoutBtn = document.getElementById("admin-logout-btn");
const cabinetRefreshBtn = document.getElementById("cabinet-refresh-btn");
const filterButtons = Array.from(document.querySelectorAll("[data-request-filter]"));
const statRequests = document.getElementById("stat-requests");
const statUnread = document.getElementById("stat-unread");
const statAnswered = document.getElementById("stat-answered");
const requestStatus = document.getElementById("cabinet-request-status");
const requestList = document.getElementById("request-list");
const requestDetail = document.getElementById("request-detail");
const requestEmpty = document.getElementById("request-empty");
const requestName = document.getElementById("request-name");
const requestDate = document.getElementById("request-date");
const requestText = document.getElementById("request-text");
const requestReply = document.getElementById("request-reply");
const requestState = document.getElementById("request-state");
const requestSaveBtn = document.getElementById("request-save-btn");
const reviewFeed = document.getElementById("review-editor-feed");
const reviewStatus = document.getElementById("review-editor-status");

let admin = null;
let requestStateItems = [];
let selectedRequestId = null;
let activeFilter = "new";
let refreshTimer = null;

function getGateFocusableElements() {
  return Array.from(
    gate.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
    )
  );
}

function setGateMessage(message) {
  gateText.textContent = message;
}

function setRequestStatus(message) {
  requestStatus.textContent = message;
}

function openGate() {
  gate.classList.add("is-open");
  gate.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => adminLoginPassword.focus());
}

function closeGate() {
  gate.classList.remove("is-open");
  gate.setAttribute("aria-hidden", "true");
}

function renderAdminUser() {
  if (!admin) {
    adminUserCard.innerHTML = `
      <div class="sidebar-user__name">Гость</div>
      <div class="sidebar-user__meta">Кабинет защищён через Supabase Auth</div>
    `;
    return;
  }

  adminUserCard.innerHTML = `
    <div class="sidebar-user__name">👋 ${escapeHtml(admin.username)}</div>
    <div class="sidebar-user__meta">${escapeHtml(admin.email)}</div>
  `;
}

function renderStats(overview) {
  statRequests.textContent = String(overview.conversations || 0);
  statUnread.textContent = String(overview.unread || 0);
  statAnswered.textContent = String(
    Math.max(0, (overview.conversations || 0) - (overview.unread || 0))
  );
}

function getFilteredRequests() {
  if (activeFilter === "all") return requestStateItems;
  return requestStateItems.filter((item) => item.status === activeFilter);
}

function renderRequestList() {
  const filtered = getFilteredRequests();

  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.requestFilter === activeFilter);
  });

  if (!filtered.length) {
    requestList.innerHTML = `
      <tr class="conversation-row conversation-row--empty">
        <td colspan="3">В этом фильтре пока нет заявок.</td>
      </tr>
    `;
    requestDetail.hidden = true;
    requestEmpty.hidden = false;
    selectedRequestId = null;
    return;
  }

  if (!selectedRequestId || !filtered.some((item) => item.id === selectedRequestId)) {
    selectedRequestId = filtered[0].id;
  }

  requestList.innerHTML = filtered
    .map(
      (item) => `
        <tr class="conversation-row ${item.id === selectedRequestId ? "is-active" : ""}" data-request-id="${escapeHtml(item.id)}">
          <td>
            <div class="conversation-cell__main">
              <strong>${escapeHtml(item.name)}</strong>
              <small>${new Date(item.created_at).toLocaleString("ru-RU")}</small>
            </div>
          </td>
          <td>
            <span class="conversation-preview">${escapeHtml(item.text)}</span>
          </td>
          <td>
            <span class="status-pill status-pill--${item.status === "answered" ? "answered" : "new"}">
              ${item.status === "answered" ? "Ответили" : "Новая"}
            </span>
          </td>
        </tr>
      `
    )
    .join("");

  renderRequestDetail();
}

function renderRequestDetail() {
  const request = requestStateItems.find((item) => item.id === selectedRequestId);
  if (!request) {
    requestDetail.hidden = true;
    requestEmpty.hidden = false;
    return;
  }

  requestDetail.hidden = false;
  requestEmpty.hidden = true;
  requestName.textContent = request.name;
  requestDate.textContent = new Date(request.created_at).toLocaleString("ru-RU");
  requestText.textContent = request.text;
  requestReply.value = request.admin_reply || "";
  requestState.value = request.status;
  setRequestStatus(`Заявка открыта: ${request.name}`);
}

function renderReviews(reviews) {
  if (!reviews.length) {
    reviewFeed.innerHTML = `
      <article class="review-item review-item--empty">
        <p class="review-item__text">Пока отзывов нет.</p>
      </article>
    `;
    return;
  }

  reviewFeed.innerHTML = reviews
    .map(
      (review, index) => `
        <article class="review-item" data-review-id="${escapeHtml(review.id)}" style="--delay: ${index * 60}ms">
          <div class="review-item__top">
            <div>
              <div class="review-item__name">${escapeHtml(review.name)}</div>
              <div class="review-item__meta">${new Date(review.created_at).toLocaleString("ru-RU")}</div>
            </div>
            <div class="review-item__rating">${starString(review.rating)}</div>
          </div>
          <label class="field">
            <span>Текст отзыва</span>
            <textarea rows="5" data-review-text>${escapeHtml(review.text)}</textarea>
          </label>
          <div class="rating-block">
            <span class="field-label">Оценка</span>
            <div class="rating" aria-label="Оценка от 1 до 5">
              ${[5, 4, 3, 2, 1]
                .map(
                  (value) => `
                    <input type="radio" name="rating-${review.id}" id="rating-${review.id}-${value}" value="${value}" ${
                      Number(review.rating) === value ? "checked" : ""
                    } />
                    <label for="rating-${review.id}-${value}">★</label>
                  `
                )
                .join("")}
            </div>
          </div>
          <div class="review-item__actions">
            <button class="auth-btn auth-btn--solid review-item__action" type="button" data-review-save="${escapeHtml(review.id)}">Сохранить</button>
            <button class="auth-btn auth-btn--ghost review-item__action review-item__action--danger" type="button" data-review-delete="${escapeHtml(review.id)}">Удалить</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function refreshDashboard() {
  setRequestStatus("Обновляем данные кабинета...");

  const [overviewResult, requestsResult, reviewsResult] = await Promise.allSettled([
    getOverview(),
    listProjectRequests("all"),
    listAdminReviews(),
  ]);

  if (overviewResult.status === "fulfilled") {
    renderStats(overviewResult.value);
  }

  if (requestsResult.status === "fulfilled") {
    requestStateItems = requestsResult.value.requests || [];

    if (activeFilter === "answered" && !requestStateItems.some((item) => item.status === "answered")) {
      activeFilter = "all";
    }

    renderRequestList();
  } else {
    requestList.innerHTML = `
      <tr class="conversation-row conversation-row--empty">
        <td colspan="3">Не удалось загрузить заявки. Обновите страницу или войдите заново.</td>
      </tr>
    `;
  }

  if (reviewsResult.status === "fulfilled") {
    const reviews = reviewsResult.value.reviews || [];
    renderReviews(reviews);
    reviewStatus.textContent = `Отзывов в базе: ${reviews.length}`;
  } else {
    reviewFeed.innerHTML = `
      <article class="review-item review-item--empty">
        <p class="review-item__text">Не удалось загрузить отзывы. Обновите страницу или войдите заново.</p>
      </article>
    `;
  }

  const errors = [overviewResult, requestsResult, reviewsResult]
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message)
    .filter(Boolean);

  setRequestStatus(errors.length ? errors[0] : "Данные кабинета обновлены.");
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (admin && document.visibilityState === "visible") {
      refreshDashboard().catch(() => {});
    }
  }, 10000);
}

async function bootstrapAuth() {
  adminEmailHint.textContent = SUPABASE_ADMIN_EMAIL;
  await adminLogout().catch(() => {});
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
  renderAdminUser();
  setGateMessage("Введите пароль администратора. Email для входа берётся из supabase-config.js.");
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await adminLogin({ password: adminLoginPassword.value });
    admin = (await getAdminMe()).admin;
    closeGate();
    renderAdminUser();
    await refreshDashboard();
    startAutoRefresh();
  } catch (error) {
    setGateMessage(error.message || "Не удалось войти в кабинет.");
  }
});

adminLogoutBtn.addEventListener("click", async () => {
  try {
    await adminLogout();
  } finally {
    admin = null;
    requestStateItems = [];
    selectedRequestId = null;
    renderAdminUser();
    requestList.innerHTML = "";
    reviewFeed.innerHTML = "";
    openGate();
    setGateMessage("Сессия завершена. Введите пароль снова.");
  }
});

cabinetRefreshBtn.addEventListener("click", async () => {
  if (!admin) return;
  await refreshDashboard();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.requestFilter;
    selectedRequestId = null;
    renderRequestList();
  });
});

requestList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-request-id]");
  if (!row) return;
  selectedRequestId = row.dataset.requestId;
  renderRequestList();
});

requestSaveBtn.addEventListener("click", async () => {
  if (!selectedRequestId) return;
  try {
    const payload = await updateProjectRequest(selectedRequestId, {
      status: requestState.value,
      admin_reply: requestReply.value,
    });
    const next = payload.request;
    requestStateItems = requestStateItems.map((item) => (item.id === next.id ? next : item));
    renderRequestList();
    setRequestStatus("Заявка сохранена в Supabase.");
  } catch (error) {
    setRequestStatus(error.message || "Не удалось обновить заявку.");
  }
});

reviewFeed.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-review-save]");
  const deleteButton = event.target.closest("[data-review-delete]");
  if (!saveButton && !deleteButton) return;

  try {
    if (deleteButton) {
      const reviewId = deleteButton.dataset.reviewDelete;
      if (!window.confirm("Удалить этот отзыв?")) return;
      await deleteAdminReview(reviewId);
      await refreshDashboard();
      return;
    }

    const reviewId = saveButton.dataset.reviewSave;
    const card = saveButton.closest(".review-item");
    const text = card.querySelector("[data-review-text]").value.trim();
    const ratingInput = card.querySelector('input[type="radio"]:checked');
    const rating = ratingInput ? Number(ratingInput.value) : 5;
    await updateAdminReview(reviewId, { text, rating });
    reviewStatus.textContent = "Отзыв сохранён.";
    await refreshDashboard();
  } catch (error) {
    reviewStatus.textContent = error.message || "Не удалось изменить отзыв.";
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && admin) {
    refreshDashboard().catch(() => {});
  }
});

document.addEventListener("keydown", (event) => {
  if (!gate.classList.contains("is-open") || event.key !== "Tab") return;

  const focusable = getGateFocusableElements();
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

await bootstrapAuth();
