function formatTime(date = new Date()) {
  return date.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getServiceFromCard(card) {
  return {
    name: card.dataset.serviceName,
    subtitle: card.dataset.serviceSubtitle,
    duration: card.dataset.serviceDuration,
    price: card.dataset.servicePrice,
  };
}

function getSelectedCount() {
  return document.querySelectorAll(".service-card.service-card--selected").length;
}

function updateSelectionChip() {
  const chip = document.querySelector("[data-selection-chip]");
  const label = document.querySelector("[data-selection-chip-label]");
  const count = getSelectedCount();

  if (!chip || !label) return;

  if (count === 0) {
    chip.hidden = true;
    return;
  }

  label.textContent = `Wybrano ${count}`;
  chip.hidden = false;
}

function clearAllSelections() {
  document.querySelectorAll(".service-card.service-card--selected").forEach((card) => {
    card.classList.remove("service-card--selected");
  });

  syncProviderServices();
}

function toggleServiceDescription(toggleBtn) {
  const card = toggleBtn.closest(".service-card");
  const expanded = card.classList.toggle("service-card--expanded");

  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-label", expanded ? "Ukryj opis usługi" : "Pokaż opis usługi");
}

function createMessageElement(text, direction) {
  const message = document.createElement("div");
  message.className = `message message--${direction}`;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = formatTime();

  message.append(paragraph, time);
  return message;
}

function scrollChatToBottom(chatBody) {
  if (!chatBody) return;
  chatBody.scrollTop = chatBody.scrollHeight;
}

function createProviderServiceItem(service) {
  const item = document.createElement("li");
  item.className = "provider-incoming-service__item";

  item.innerHTML = `
    <strong class="provider-incoming-service__name"></strong>
    <span class="provider-incoming-service__subtitle"></span>
    <div class="provider-incoming-service__meta">
      <span class="provider-incoming-service__duration"></span>
      <span class="provider-incoming-service__price"></span>
    </div>
  `;

  item.querySelector(".provider-incoming-service__name").textContent = service.name;
  item.querySelector(".provider-incoming-service__subtitle").textContent = service.subtitle;
  item.querySelector(".provider-incoming-service__duration").textContent = service.duration;
  item.querySelector(".provider-incoming-service__price").textContent = service.price;

  return item;
}

function syncProviderServices() {
  const panel = document.querySelector("[data-provider-service]");
  const list = document.querySelector("[data-provider-service-list]");
  const selectedCards = document.querySelectorAll(".service-card.service-card--selected");

  if (!panel || !list) return;

  list.innerHTML = "";

  if (selectedCards.length === 0) {
    panel.hidden = true;
    updateSelectionChip();
    return;
  }

  selectedCards.forEach((card) => {
    list.appendChild(createProviderServiceItem(getServiceFromCard(card)));
  });

  panel.hidden = false;
  updateSelectionChip();

  const providerChat = document.querySelector('[data-chat="provider"]');
  scrollChatToBottom(providerChat);
}

function toggleService(card) {
  const isSelected = card.classList.contains("service-card--selected");

  if (isSelected) {
    card.classList.remove("service-card--selected");
  } else {
    card.classList.add("service-card--selected");
  }

  syncProviderServices();
}

function sendMessage(sender) {
  const form = document.querySelector(`.chat-input[data-role="${sender}"]`);
  const input = form.elements.message;
  const text = input.value.trim();

  if (!text) return;

  const userChat = document.querySelector('[data-chat="user"]');
  const providerChat = document.querySelector('[data-chat="provider"]');
  const userLive = document.querySelector('[data-live-messages="user"]');
  const providerLive = document.querySelector('[data-live-messages="provider"]');

  if (sender === "user") {
    userLive.appendChild(createMessageElement(text, "outgoing"));
    providerLive.appendChild(createMessageElement(text, "incoming"));
  } else {
    providerLive.appendChild(createMessageElement(text, "outgoing"));
    userLive.appendChild(createMessageElement(text, "incoming"));
  }

  input.value = "";
  input.focus();
  scrollChatToBottom(userChat);
  scrollChatToBottom(providerChat);
}

document.querySelectorAll(".service-card").forEach((card) => {
  card.addEventListener("click", (event) => {
    if (event.target.closest(".service-card__toggle")) return;
    toggleService(card);
  });
});

document.querySelectorAll(".service-card__toggle").forEach((toggleBtn) => {
  toggleBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleServiceDescription(toggleBtn);
  });
});

document.querySelector(".selection-chip__clear")?.addEventListener("click", clearAllSelections);

document.querySelectorAll(".chat-input[data-role]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(form.dataset.role);
  });
});

updateSelectionChip();
