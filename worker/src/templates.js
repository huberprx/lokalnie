const APP_URL = "https://lokalnie.app";

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

const INTROS = {
  booking_created: "Dziękujemy — zapisaliśmy rezerwację. Wkrótce dostaniesz potwierdzenie.",
  booking_confirmed: "Termin jest potwierdzony. Do zobaczenia!",
  booking_pending: "Rezerwacja czeka na potwierdzenie ze strony usługodawcy.",
  booking_proposed: "Usługodawca zaproponował zmianę terminu. Sprawdź szczegóły w aplikacji.",
  booking_rejected: "Niestety ta rezerwacja została odrzucona.",
  booking_cancelled: "Rezerwacja została odwołana.",
  request_new: "Klient prosi o termin. Odpowiedz w aplikacji Lokalnie.",
  request_proposed: "Masz nowe propozycje terminów do wyboru.",
};

const STATUS_LABELS = {
  confirmed: "Potwierdzona",
  pending: "Oczekuje",
  proposed: "Propozycja zmiany",
  rejected: "Odrzucona",
  cancelled: "Odwołana",
  created: "Utworzona",
};

export function renderEmail(template, payload = {}) {
  const subject = SUBJECTS[template];
  if (!subject) throw new Error("unknown_email_template");

  const intro = INTROS[template] || "";
  const rows = buildDetailRows(payload);
  const text = buildText({ subject, intro, rows, payload });
  const html = buildHtml({ subject, intro, rows, payload });
  return { subject, text, html };
}

function buildDetailRows(payload) {
  const rows = [];
  if (payload.providerName) rows.push(["Usługodawca", String(payload.providerName)]);
  if (payload.clientName) rows.push(["Klient", String(payload.clientName)]);
  if (payload.dateISO) rows.push(["Data", String(payload.dateISO)]);
  if (payload.from && payload.to) rows.push(["Godzina", `${payload.from}–${payload.to}`]);
  if (payload.status) {
    rows.push(["Status", STATUS_LABELS[payload.status] || String(payload.status)]);
  }
  if (Array.isArray(payload.proposals) && payload.proposals.length) {
    const list = payload.proposals
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const date = item.dateISO || "—";
        const time =
          item.from && item.to ? `${item.from}–${item.to}` : item.from || item.to || "—";
        return `${index + 1}. ${date}, ${time}`;
      })
      .filter(Boolean)
      .join("\n");
    if (list) rows.push(["Propozycje", list]);
  }
  if (payload.bookingId) rows.push(["Nr rezerwacji", String(payload.bookingId)]);
  if (payload.requestId) rows.push(["Nr prośby", String(payload.requestId)]);
  return rows;
}

function buildText({ subject, intro, rows, payload }) {
  const lines = ["Lokalnie", subject, ""];
  if (intro) lines.push(intro, "");
  for (const [label, value] of rows) {
    lines.push(`${label}: ${String(value).replaceAll("\n", " | ")}`);
  }
  lines.push("", `Otwórz aplikację: ${APP_URL}`);
  if (payload.bookingId || payload.requestId) {
    lines.push("", "—", "Wiadomość wysłana automatycznie przez Lokalnie.");
  }
  return lines.join("\n");
}

function buildHtml({ subject, intro, rows }) {
  const detailRows = rows
    .map(([label, value]) => {
      const formatted = escapeHtml(value).replaceAll("\n", "<br>");
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e8eaef;color:#6b7280;font-size:14px;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e8eaef;color:#1a1d24;font-size:14px;font-weight:600;vertical-align:top;">${formatted}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1d24;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fa;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px 18px;border-bottom:1px solid #e8eaef;">
              <div style="font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#5b8def;">Lokalnie</div>
              <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:700;color:#1a1d24;">${escapeHtml(subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px;">
              ${intro ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#4b5563;">${escapeHtml(intro)}</p>` : ""}
              ${
                detailRows
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows}</table>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <a href="${APP_URL}" style="display:inline-block;margin-top:10px;background:#5b8def;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 18px;border-radius:10px;">Otwórz Lokalnie</a>
              <p style="margin:18px 0 0;font-size:12px;line-height:1.4;color:#9ca3af;">Wiadomość wysłana automatycznie · nie odpowiadaj na ten adres</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
