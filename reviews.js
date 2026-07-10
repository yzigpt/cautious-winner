import { escapeHtml, starString } from "./storage.js";
import { getPublicReviews, createReview } from "./site-api.js?v=20260710-security";

const reviewForm = document.getElementById("review-form");
const reviewNameInput = document.getElementById("review-name");
const reviewTextInput = document.getElementById("review-text");
const reviewsFeed = document.getElementById("reviews-feed");
const reviewStatus = document.getElementById("review-status");
const ratingInputs = Array.from(document.querySelectorAll('input[name="rating"]'));

let currentReviews = [];
let lastReviewsSnapshot = "";
let reviewsRefreshTimer = null;

function setRating(value) {
  const input = ratingInputs.find((item) => Number(item.value) === Number(value));
  if (input) input.checked = true;
}

function getRating() {
  const checked = ratingInputs.find((item) => item.checked);
  return checked ? Number(checked.value) : 5;
}

function getReviewsSnapshot(reviews) {
  return reviews
    .map(
      (review) =>
        [
          review.id,
          review.name,
          review.text,
          review.rating,
          review.created_at || review.createdAt || "",
          review.updated_at || review.updatedAt || "",
        ].join("|")
    )
    .join("~");
}

function renderReviewCards(reviews) {
  currentReviews = reviews.slice(0, 12);
  lastReviewsSnapshot = getReviewsSnapshot(reviews);

  if (!reviews.length) {
    reviewsFeed.innerHTML = `
      <article class="review-item review-item--empty">
        <p class="review-item__text">Пока отзывов нет. Будьте первым и оставьте своё впечатление.</p>
      </article>
    `;
    return;
  }

  reviewsFeed.innerHTML = reviews
    .map(
      (review, index) => `
        <article class="review-item" style="--delay: ${index * 70}ms">
          <div class="review-item__top">
            <div>
              <div class="review-item__name">${escapeHtml(review.name)}</div>
              <div class="review-item__meta">${new Date(review.created_at || review.createdAt).toLocaleString("ru-RU")}</div>
            </div>
            <div class="review-item__rating">${starString(review.rating)}</div>
          </div>
          <p class="review-item__text">${escapeHtml(review.text)}</p>
        </article>
      `
    )
    .join("");
}

async function loadReviews() {
  try {
    const reviews = await getPublicReviews(12);
    const snapshot = getReviewsSnapshot(reviews);
    if (snapshot !== lastReviewsSnapshot) {
      renderReviewCards(reviews);
    }
    currentReviews = reviews.slice(0, 12);
  } catch (error) {
    reviewsFeed.innerHTML = `
      <article class="review-item review-item--empty">
        <p class="review-item__text">${escapeHtml(error.message || "Не удалось загрузить отзывы.")}</p>
      </article>
    `;
  }
}

function setStatus(message) {
  reviewStatus.textContent = message;
}

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = reviewNameInput.value.trim();
  const text = reviewTextInput.value.trim();
  if (!text) return;

  try {
    const createdReview = await createReview({ name: name || "Гость", text, rating: getRating() });
    reviewForm.reset();
    setRating(5);
    currentReviews = [createdReview, ...currentReviews.filter((item) => item.id !== createdReview.id)].slice(0, 12);
    renderReviewCards(currentReviews);
    setStatus("Отзыв сохранён и уже появился в списке.");
  } catch (error) {
    setStatus(error.message || "Не удалось сохранить отзыв.");
  }
});

setRating(5);
await loadReviews();

reviewsRefreshTimer = setInterval(() => {
  if (document.visibilityState === "visible") {
    loadReviews().catch(() => {});
  }
}, 15000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadReviews().catch(() => {});
  }
});
