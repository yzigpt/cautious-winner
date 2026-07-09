export const STORAGE_KEYS = {
  user: "xd_current_user",
  reviews: "xd_reviews",
};

export function loadUser() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.user)) ?? null;
  } catch {
    return null;
  }
}

export function saveUser(user) {
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem(STORAGE_KEYS.user);
}

export function loadReviews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.reviews));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReviews(reviews) {
  localStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(reviews));
}

export function normalizePhone(value) {
  return value.replace(/[^\d+]/g, "");
}

export function formatPhone(value) {
  const normalized = normalizePhone(value);
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function starString(value) {
  return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, 5 - value);
}

export function generateReviewId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `review_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
