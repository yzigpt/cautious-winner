import { sendMessage } from "./site-api.js?v=20260710-guest-requests";
import { getCurrentSession } from "./auth.js";

const contactForm = document.getElementById("contact-form");
const contactNameInput = document.getElementById("contact-name");
const contactDetailsInput = document.getElementById("contact-details");
const contactWebsiteInput = document.getElementById("contact-website");
const contactTextInput = document.getElementById("contact-text");
const contactStatus = document.getElementById("contact-status");
const submitButton = contactForm?.querySelector('button[type="submit"]');
const cooldownKey = "frog-oxide-request-cooldown-until";

function startCooldown(until) {
  const update = () => {
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (!seconds) {
      submitButton.disabled = false;
      submitButton.textContent = "Отправить заявку";
      localStorage.removeItem(cooldownKey);
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = `Следующая заявка через ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    window.setTimeout(update, 1000);
  };
  update();
}

function setStatus(message) {
  contactStatus.textContent = message;
}

if (contactForm) {
  const session = await getCurrentSession();
  const savedCooldown = Number(localStorage.getItem(cooldownKey) || 0);
  if (savedCooldown > Date.now()) startCooldown(savedCooldown);
  if (session?.user.user_metadata?.display_name && !contactNameInput.value) {
    contactNameInput.value = session.user.user_metadata.display_name;
  }

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = contactNameInput.value.trim();
    const contactDetails = contactDetailsInput.value.trim();
    const text = contactTextInput.value.trim();

    if (!name || !contactDetails || !text) {
      setStatus("Пожалуйста, заполните имя, контакт и сообщение.");
      return;
    }

    setStatus("Отправляем заявку...");

    try {
      await sendMessage({ name, contact_details: contactDetails, text, website: contactWebsiteInput.value });
      contactForm.reset();
      const until = Date.now() + 10 * 60 * 1000;
      localStorage.setItem(cooldownKey, String(until));
      startCooldown(until);
      setStatus("✅ Заявка отправлена. Скоро с вами свяжутся.");
    } catch (error) {
      setStatus(error.message || "Не удалось отправить заявку.");
    }
  });
}
