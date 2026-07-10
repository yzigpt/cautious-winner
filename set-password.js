import { getSupabase } from "./supabase-client.js";

const form = document.getElementById("set-password-form");
const status = document.getElementById("set-password-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("new-password").value;
  const repeated = document.getElementById("repeat-password").value;
  if (password !== repeated) {
    status.textContent = "Пароли не совпадают.";
    return;
  }
  try {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) throw error;
    status.textContent = "Пароль установлен. Перенаправляем в личный кабинет...";
    window.setTimeout(() => { window.location.href = "profile.html"; }, 900);
  } catch (error) {
    status.textContent = error.message || "Не удалось установить пароль. Откройте ссылку из письма ещё раз.";
  }
});
