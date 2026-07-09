import {
  adminLogin,
  adminSetup,
  deleteAdminReview,
  getAdminStatus,
  listAdminReviews,
  updateAdminReview,
} from "./admin-api.js";
import { escapeHtml, starString } from "./storage.js";

const gate = document.getElementById("admin-gate");
const gateText = document.getElementById("admin-gate-text");
const adminTabs = Array.from(document.querySelectorAll("[data-admin-tab]"));
const adminLoginForm = document.getElementById("admin-login-form");
const adminSetupForm = document.getElementById("admin-setup-form");
const adminLoginUsername = document.getElementById("admin-login-username");
const adminLoginPassword = document.getElementById("admin-login-password");
const adminSetupUsername = document.getElementById("admin-setup-username");
const adminSetupPassword = document.getElementById("admin-setup-password");
const status = document.getElementById("editor-status");
const feed = document.getElementById("editor-feed");

let needsSetup = true;

function openGate(tab = "login") {
  gate.classList.add("is-open");
  gate.setAttribute("aria-hidden", "false");
  setGateTab(tab);
}

function closeGate() {
  gate.classList.remove("is-open");
  gate.setAttribute("aria-hidden", "true");
}

function setGateTab(tab) {
  adminTabs.forEach((button) => {
    const active = button.dataset.adminTab === tab;
    button.classList.toggle("is-active", active);
  });
  adminLoginForm.hidden = tab !== "login";
  adminSetupForm.hidden = tab !== "setup";
}

function setGateMessage(message) {
  gateText.textContent = message;
}

function renderReviews(reviews) {
  if (!reviews.length) {
    feed.innerHTML = `
      <article class="review-item review-item--empty">
        <p class="review-item__text">Пока отзывов нет.</p>
      </article>
    `;
    return;
  }

  feed.innerHTML = reviews
    .map(
      (review, index) => `
        <article class="review-item" data-review-id="${escapeHtml(review.id)}" style="--delay: ${index * 70}ms">
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

async function refreshPage() {
  const payload = await listAdminReviews();
  renderReviews(payload.reviews || []);
  status.textContent = `Показано отзывов: ${(payload.reviews || []).length}`;
}

async function bootstrap() {
  const statusPayload = await getAdminStatus();
  needsSetup = statusPayload.needsSetup;

  if (statusPayload.authenticated) {
    closeGate();
    await refreshPage();
    return;
  }

  openGate(needsSetup ? "setup" : "login");
  setGateMessage(
    needsSetup
      ? "Сначала создайте логин и пароль администратора. После этого страница станет защищённой."
      : "Введите логин и пароль для входа в редактор отзывов."
  );
  status.textContent = "Требуется вход администратора.";
}

adminTabs.forEach((button) => {
  button.addEventListener("click", () => setGateTab(button.dataset.adminTab));
});

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await adminLogin({
      username: adminLoginUsername.value.trim(),
      password: adminLoginPassword.value,
    });
    closeGate();
    await refreshPage();
  } catch (error) {
    setGateMessage(error.message || "Не удалось войти.");
  }
});

adminSetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await adminSetup({
      username: adminSetupUsername.value.trim(),
      password: adminSetupPassword.value,
    });
    closeGate();
    await refreshPage();
  } catch (error) {
    setGateMessage(error.message || "Не удалось создать доступ.");
  }
});

feed.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-review-save]");
  const deleteButton = event.target.closest("[data-review-delete]");
  if (!saveButton && !deleteButton) return;

  if (deleteButton) {
    const reviewId = deleteButton.dataset.reviewDelete;
    if (!window.confirm("Удалить этот отзыв?")) return;
    await deleteAdminReview(reviewId);
    await refreshPage();
    return;
  }

  const reviewId = saveButton.dataset.reviewSave;
  const card = saveButton.closest(".review-item");
  const text = card.querySelector("[data-review-text]").value.trim();
  const ratingInput = card.querySelector('input[type="radio"]:checked');
  const rating = ratingInput ? Number(ratingInput.value) : 5;
  await updateAdminReview(reviewId, { text, rating });
  await refreshPage();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGate();
  }
});

await bootstrap();
