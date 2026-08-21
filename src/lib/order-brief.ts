// Client-safe helpers for the KERJAKU Order Brief follow-up (CRM delivery).
// Pure formatting/normalisation only — no AI Consultant logic is touched here.


export type OrderBriefData = {
  version: number;
  customerName: string;
  whatsapp: string | null;
  email: string | null;
  business: string;
  project: string;
  goal: string | null;
  problems: string[];
  usersScale: string | null;
  adminNeeds: string | null;
  features: string[];
  timeline: string | null;
  budget: string | null;
  recommendation: string | null;
  source?: "ai" | "manual" | null;
  createdAt: string;
};

/** Normalise an Indonesian phone number to WhatsApp format (628xxxxxxxxx). */
export function normalizeWhatsapp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  else if (digits.startsWith("620")) digits = `62${digits.slice(3)}`;
  if (!digits.startsWith("62")) digits = `62${digits}`;
  return digits.length >= 10 ? digits : null;
}

export function waLink(number: string, message: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Customer"
  );
}

export function briefFileName(customerName: string) {
  return `Order_Brief_KERJAKU_${safeName(customerName)}.pdf`;
}

/** Jakarta (WIB) date + time strings. */
export function wibStamp(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  const tz = "Asia/Jakarta";
  return {
    date: date.toLocaleDateString("id-ID", {
      timeZone: tz,
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    time: `${date.toLocaleTimeString("id-ID", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
    })} WIB`,
  };
}

/** Intro paragraphs (shared by WhatsApp + email). */
function introLines(brief: OrderBriefData) {
  return [
    `Halo Kak ${brief.customerName || "Customer"}, terima kasih sudah melakukan konsultasi bersama Team KERJAKU Consultant.`,
    "",
    "Berikut hasil preview konsultasi awal Kakak yang sudah kami rangkum dalam Order Brief KERJAKU.",
    "",
    "Jika ada tambahan fitur, perubahan kebutuhan, atau ingin konsultasi lanjutan bisa langsung informasikan kepada kami ya Kak.",
  ];
}

function closingLines() {
  return [
    "Team KERJAKU akan melakukan pengecekan kebutuhan terlebih dahulu.",
    "Setelah kebutuhan sudah final, tim kami akan memberikan rekomendasi solusi dan penawaran harga yang sesuai.",
    "",
    "Terima kasih sudah mempercayakan konsultasi kepada KERJAKU 🙏",
  ];
}

/**
 * Message sent to the customer via email.
 * Date/time always come from when the Order Brief was created, never from send time.
 */
export function buildFollowUpMessage(
  brief: OrderBriefData,
  options?: { stampIso?: string; pdfUrl?: string | null },
) {
  const { date, time } = wibStamp(options?.stampIso ?? brief.createdAt);
  const lines = [
    ...introLines(brief),
    "",
    "📎 Order Brief KERJAKU",
    "",
    "File:",
    briefFileName(brief.customerName),
  ];
  if (options?.pdfUrl) {
    lines.push("", "Download PDF:", options.pdfUrl);
  }
  lines.push("", `Tanggal:`, date, "", `Jam:`, time, "", ...closingLines());
  return lines.join("\n");
}

/**
 * WhatsApp-specific message with a clean labeled link instead of a raw signed URL.
 * Date/time always come from when the Order Brief was created, never from send time.
 */
export function buildWhatsappFollowUpMessage(
  brief: OrderBriefData,
  options?: { stampIso?: string; pdfUrl?: string | null },
) {
  const { date, time } = wibStamp(options?.stampIso ?? brief.createdAt);
  const lines = [
    ...introLines(brief),
    "",
    "📎 Order Brief:",
    briefFileName(brief.customerName),
  ];
  if (options?.pdfUrl) {
    // WhatsApp cannot render markdown links — send the short URL so it stays clickable.
    lines.push("", "📥 Download PDF:", options.pdfUrl);
  }

  lines.push("", `Tanggal:`, date, "", `Jam:`, time, "", ...closingLines());
  return lines.join("\n");
}

/** Body only (no attachment block) — used by the reusable DocumentActions packet. */
export function buildFollowUpBody(brief: OrderBriefData, stampIso?: string) {
  const { date, time } = wibStamp(stampIso ?? brief.createdAt);
  return [
    ...introLines(brief),
    "",
    "Tanggal:",
    date,
    "",
    "Jam:",
    time,
    "",
    ...closingLines(),
  ].join("\n");
}


/** Order Brief delivery workflow status. */
export type OrderBriefStatus = "None" | "Generated" | "Reviewed" | "Sent WhatsApp" | "Sent Email";

export function orderBriefStatus(input: {
  hasBrief: boolean;
  reviewed: boolean;
  sentWhatsapp: boolean;
  sentEmail: boolean;
}): OrderBriefStatus {
  if (!input.hasBrief) return "None";
  if (input.sentEmail) return "Sent Email";
  if (input.sentWhatsapp) return "Sent WhatsApp";
  if (input.reviewed) return "Reviewed";
  return "Generated";
}

export function emailSubject(brief: OrderBriefData) {
  return `Order Brief Konsultasi KERJAKU - ${brief.customerName}`;
}

/** Ordered field list used by both the preview UI and the PDF. */
export function briefFields(brief: OrderBriefData): { label: string; value: string }[] {
  const list = (items: string[]) => (items.length ? items.map((i) => `• ${i}`).join("\n") : "-");
  return [
    { label: "Bisnis", value: brief.business || "-" },
    { label: "Project", value: brief.project || "-" },
    { label: "Tujuan", value: brief.goal || "-" },
    { label: "Masalah Bisnis", value: list(brief.problems) },
    { label: "User Sistem", value: brief.usersScale || "-" },
    { label: "Kebutuhan Admin/Team", value: brief.adminNeeds || "-" },
    { label: "Fitur", value: list(brief.features) },
    { label: "Timeline", value: brief.timeline || "-" },
    { label: "Budget", value: brief.budget || "-" },
    { label: "Package Recommendation", value: brief.recommendation || "-" },
    { label: "Source", value: brief.source === "manual" ? "MANUAL_FORM" : "AI_CHATBOT" },
  ];
}
