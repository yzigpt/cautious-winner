import { sendMessage } from "./site-api.js";

const form = document.getElementById("home-contact-form");
const nameInput = document.getElementById("home-contact-name");
const phoneInput = document.getElementById("home-contact-phone");
const textInput = document.getElementById("home-contact-text");
const status = document.getElementById("home-contact-status");

function setStatus(message) {
  status.textContent = message;
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const text = textInput.value.trim();

    if (!name || !phone || !text) {
      setStatus("Пожалуйста, заполните имя, телефон и сообщение.");
      return;
    }

    setStatus("Отправляем заявку в кабинет...");

    try {
      await sendMessage({ name, phone, text });
      form.reset();
      setStatus("✅ Заявка отправлена. Она уже появилась в кабинете.");
    } catch (error) {
      setStatus(error.message || "Не удалось отправить заявку.");
    }
  });
}
