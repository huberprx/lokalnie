const CALENDAR_STORAGE_KEY = "lokalnie.googleCalendars";
const TIMEZONE = "Europe/Warsaw";

const CALENDAR_COLORS = {
  user: "#5b8def",
  provider: "#3ecf8e",
};

function loadCalendars() {
  try {
    return JSON.parse(localStorage.getItem(CALENDAR_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCalendars(calendars) {
  localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendars));
}

function buildEmbedUrl(calendarId, role) {
  const params = new URLSearchParams({
    height: "420",
    wkst: "2",
    bgcolor: "#1a1d27",
    ctz: TIMEZONE,
    mode: "WEEK",
    showTitle: "0",
    showNav: "1",
    showDate: "1",
    showPrint: "0",
    showTabs: "1",
    showCalendars: "0",
    src: calendarId,
    color: CALENDAR_COLORS[role],
  });

  return `https://calendar.google.com/calendar/embed?${params.toString()}`;
}

function renderCalendar(role, calendarId) {
  const frame = document.querySelector(`.calendar-frame[data-role="${role}"]`);
  const input = document.querySelector(`.calendar-connect[data-role="${role}"] input`);

  if (!frame) return;

  input.value = calendarId;
  frame.innerHTML = "";

  const iframe = document.createElement("iframe");
  iframe.src = buildEmbedUrl(calendarId, role);
  iframe.title = `Kalendarz Google — ${role === "user" ? "użytkownik" : "usługodawca"}`;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  frame.appendChild(iframe);
}

function connectCalendar(role, calendarId) {
  const trimmed = calendarId.trim();
  if (!trimmed) return;

  const calendars = loadCalendars();
  calendars[role] = trimmed;
  saveCalendars(calendars);
  renderCalendar(role, trimmed);
}

document.querySelectorAll(".calendar-connect").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const role = form.dataset.role;
    const calendarId = form.elements.calendarId.value;
    connectCalendar(role, calendarId);
  });
});

const saved = loadCalendars();
if (saved.user) renderCalendar("user", saved.user);
if (saved.provider) renderCalendar("provider", saved.provider);
