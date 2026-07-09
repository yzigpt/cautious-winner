export async function fetchChatMessages(conversationId = "") {
  const url = conversationId
    ? `/api/chat/messages?conversationId=${encodeURIComponent(conversationId)}`
    : "/api/chat/messages";

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось получить сообщения.");
  }

  return payload.messages ?? [];
}

export async function sendChatMessage({ conversationId, sender, name, text }) {
  const response = await fetch("/api/chat/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conversationId, sender, name, text }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось отправить сообщение.");
  }

  return payload.message;
}

export function subscribeChat(onMessage) {
  const source = new EventSource("/api/chat/stream");
  source.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    onMessage(payload);
  });
  return source;
}
