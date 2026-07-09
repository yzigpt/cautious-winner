export async function getVisitor() {
  const response = await fetch("/api/auth/me");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось получить данные пользователя.");
  }
  return payload.user ?? null;
}

export async function getPublicReviews(limit = 8) {
  const response = await fetch(`/api/reviews?limit=${limit}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось загрузить отзывы.");
  }
  return payload.reviews ?? [];
}

export async function createReview({ name, text, rating }) {
  const response = await fetch("/api/reviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, text, rating }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось сохранить отзыв.");
  }

  return payload.review;
}

export async function sendMessage({ name, phone, text }) {
  const response = await fetch("/api/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, phone, text }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось отправить сообщение.");
  }

  return payload;
}
