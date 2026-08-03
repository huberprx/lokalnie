const SUBJECTS = {
  booking_created: "Otrzymaliśmy Twoją rezerwację",
  booking_confirmed: "Rezerwacja potwierdzona",
  booking_pending: "Rezerwacja oczekuje na potwierdzenie",
  booking_proposed: "Zaproponowano zmianę rezerwacji",
  booking_rejected: "Rezerwacja odrzucona",
  booking_cancelled: "Rezerwacja odwołana",
  request_new: "Nowa prośba o termin",
  request_proposed: "Otrzymałeś propozycje terminów",
};

export function renderEmail(template, payload = {}) {
  const subject = SUBJECTS[template];
  if (!subject) throw new Error("unknown_email_template");
  const details = [
    payload.clientName && `Klient: ${payload.clientName}`,
    payload.dateISO && `Data: ${payload.dateISO}`,
    payload.from && payload.to && `Godzina: ${payload.from}–${payload.to}`,
    payload.status && `Status: ${payload.status}`,
    payload.bookingId && `Rezerwacja: ${payload.bookingId}`,
    payload.requestId && `Prośba: ${payload.requestId}`,
  ].filter(Boolean);
  const text = [subject, ...details].join("\n");
  const html = `<h1>${escapeHtml(subject)}</h1>${details
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")}`;
  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
