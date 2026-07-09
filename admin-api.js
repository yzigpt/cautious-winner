async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Запрос не выполнен.");
  }
  return payload;
}

export const getAdminStatus = () => requestJson("/api/admin/status");
export const getAdminMe = () => requestJson("/api/admin/me");
export const adminSetup = (body) =>
  requestJson("/api/admin/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const adminLogin = (body) =>
  requestJson("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const adminLogout = () =>
  requestJson("/api/admin/logout", { method: "POST" });
export const getOverview = () => requestJson("/api/admin/overview");
export const listAdminReviews = () => requestJson("/api/admin/reviews");
export const updateAdminReview = (id, body) =>
  requestJson(`/api/admin/reviews/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const deleteAdminReview = (id) =>
  requestJson(`/api/admin/reviews/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
export const listConversations = () => requestJson("/api/admin/conversations");
export const getConversationMessages = (id) =>
  requestJson(`/api/admin/conversations/${encodeURIComponent(id)}/messages`);
export const sendAdminMessage = (id, body) =>
  requestJson(`/api/admin/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const changeAdminPassword = (body) =>
  requestJson("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
