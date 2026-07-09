export async function sendSmsCode({ name, phone, mode }) {
  const response = await fetch("/api/auth/send-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, phone, mode }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось отправить SMS-код.");
  }

  return payload;
}

export async function verifySmsCode({ name, phone, code }) {
  const response = await fetch("/api/auth/verify-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, phone, code }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Не удалось подтвердить код.");
  }

  return payload;
}
