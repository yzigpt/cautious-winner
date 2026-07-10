import { sendMessage } from "./site-api.js?v=20260710-telegram";

const contactForm = document.getElementById("contact-form");
const contactNameInput = document.getElementById("contact-name");
const contactTextInput = document.getElementById("contact-text");
const contactStatus = document.getElementById("contact-status");

function setStatus(message) {
  contactStatus.textContent = message;
}

if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = contactNameInput.value.trim();
    const text = contactTextInput.value.trim();

    if (!name || !text) {
      setStatus("Пожалуйста, заполните имя и сообщение.");
      return;
    }

    setStatus("Отправляем заявку...");

    try {
      await sendMessage({ name, text });
      contactForm.reset();
      setStatus("✅ Заявка отправлена. Скоро с вами свяжутся.");
    } catch (error) {
      setStatus(error.message || "Не удалось отправить заявку.");
    }
  });
}
