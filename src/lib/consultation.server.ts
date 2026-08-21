// Server-only consultation handling: persistence + notification formatting.
import type {
  AiConsultationPayload,
  ConsultationForm,
  LeadTrackingPayload,
} from "./consultation-schema";

export const LEAD_EMAIL = "admin.kerjaku@gmail.com";

function line(label: string, value?: string | null) {
  return `${label}\n${value && value.trim() ? value.trim() : "-"}\n`;
}

function aiTextLines(ai?: AiConsultationPayload) {
  if (!ai) return [] as string[];
  return [
    "--- AI CONSULTANT ---",
    line("Kategori Bisnis:", ai.businessCategory),
    line("Masalah:", ai.problems.join(", ")),
    line("Kebutuhan:", ai.requirements.join(", ")),
    line("Rekomendasi Paket:", ai.packageName),
    line("Kompleksitas:", ai.complexity),
    line("AI Score:", `${ai.score}/100 (${ai.qualification})`),
    line("Ringkasan AI:", ai.summary),
  ];
}

export function formatLeadEmail(
  data: ConsultationForm,
  createdAt: string,
  tracking?: LeadTrackingPayload,
  ai?: AiConsultationPayload,
) {
  return {
    subject: `[Konsultasi KERJAKU] Project Baru - ${data.name}`,
    text: [
      "KONSULTASI BARU KERJAKU",
      "",
      line("Nama:", data.name),
      line("Email:", data.email),
      line("WhatsApp:", data.whatsapp),
      line("Jenis Project:", data.projectType),
      line("Kebutuhan:", data.requirement),
      line("Budget:", data.budget),
      line("Timeline:", data.timeline),
      line("Nama Bisnis:", data.businessName),
      line("Fitur:", data.features),
      line("Catatan:", data.notes),
      line("Tanggal Submit:", createdAt),
      ...(tracking
        ? [
            "--- LEAD INTELLIGENCE ---",
            line("Lead Score:", `${tracking.leadScore} (${tracking.leadTemperature})`),
            line("Sumber:", tracking.visitorSource),
            line("UTM:", `${tracking.utmSource}/${tracking.utmMedium}/${tracking.utmCampaign}`),
            line("Referrer:", tracking.referrer),
            line("Landing Page:", tracking.landingPage),
            line("Halaman Dikunjungi:", tracking.visitedPages.join(" > ")),
            line("Produk Dilihat:", tracking.viewedProducts.join(", ")),
            line("Paket Dipilih:", tracking.selectedPackage),
            line("Device:", tracking.deviceType),
            line("Durasi Kunjungan:", `${tracking.visitDurationSeconds} detik`),
          ]
        : []),
    ].join("\n"),
  };
}

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatLeadTelegram(
  data: ConsultationForm,
  createdAt: string,
  tracking?: LeadTrackingPayload,
  ai?: AiConsultationPayload,
) {
  const row = (label: string, value?: string) =>
    `<b>${label}:</b>\n${value && value.trim() ? esc(value.trim()) : "-"}`;
  return [
    "🔔 <b>LEAD BARU KERJAKU</b>",
    "",
    row("Nama", data.name),
    "",
    row("Email", data.email),
    "",
    row("WhatsApp", data.whatsapp),
    "",
    row("Project", data.projectType),
    "",
    row("Budget", data.budget),
    "",
    row("Timeline", data.timeline),
    "",
    row("Kebutuhan", data.requirement),
    "",
    row("Fitur", data.features),
    "",
    row("Catatan", data.notes),
    "",
    row("Tanggal", createdAt),
    ...(tracking
      ? [
          "",
          `<b>Lead Score:</b> ${tracking.leadScore} (${esc(tracking.leadTemperature)})`,
          "",
          row("Sumber", tracking.visitorSource),
          "",
          row("Campaign", tracking.utmCampaign),
          "",
          row("Landing Page", tracking.landingPage),
          "",
          row("Produk Dilihat", tracking.viewedProducts.join(", ")),
          "",
          row("Paket Dipilih", tracking.selectedPackage),
          "",
          row("Device", tracking.deviceType),
          "",
          row("Durasi Kunjungan", `${tracking.visitDurationSeconds} detik`),
        ]
      : []),
    ...(ai
      ? [
          "",
          "🤖 <b>AI CONSULTANT</b>",
          "",
          row("Kategori Bisnis", ai.businessCategory),
          "",
          row("Masalah", ai.problems.join(", ")),
          "",
          row("Kebutuhan", ai.requirements.join(", ")),
          "",
          row("Rekomendasi Paket", ai.packageName),
          "",
          row("Kompleksitas", ai.complexity),
          "",
          `<b>AI Score:</b> ${ai.score}/100 (${esc(ai.qualification)})`,
        ]
      : []),
  ].join("\n");
}

/** Persist the lead. Returns the row id when stored. */
export async function storeConsultation(
  data: ConsultationForm,
  tracking?: LeadTrackingPayload,
  ai?: AiConsultationPayload,
  leadSource: "ai_consultant" | "manual_form" = "manual_form",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("consultations")
    .insert({
      name: data.name,
      email: data.email,
      whatsapp: data.whatsapp,
      project_type: data.projectType,
      requirement: data.requirement,
      budget: data.budget,
      timeline: data.timeline,
      business_name: data.businessName || null,
      features: data.features || null,
      notes: data.notes || null,
      company: data.businessName || null,
      status: "New",
      utm_source: tracking?.utmSource || null,
      utm_medium: tracking?.utmMedium || null,
      utm_campaign: tracking?.utmCampaign || null,
      referrer: tracking?.referrer || null,
      landing_page: tracking?.landingPage || null,
      visited_pages: tracking?.visitedPages ?? [],
      visitor_source: tracking?.visitorSource || "direct",
      selected_package: tracking?.selectedPackage || null,
      viewed_products: tracking?.viewedProducts ?? [],
      clicked_ctas: tracking?.clickedCtas ?? [],
      journey: tracking?.journey ?? [],
      visit_duration_seconds: tracking?.visitDurationSeconds ?? 0,
      device_type: tracking?.deviceType || null,
      lead_score: tracking?.leadScore ?? 0,
      lead_temperature: tracking?.leadTemperature || "Cold Lead",
      ai_summary: ai?.summary || null,
      ai_recommended_package: ai?.packageName || null,
      ai_business_category: ai?.businessCategory || null,
      ai_problems: ai?.problems ?? [],
      ai_requirements: ai?.requirements ?? [],
      ai_lead_score: ai?.score ?? 0,
      ai_qualification_status: ai?.qualification || null,
      ai_complexity: ai?.complexity || null,
      ai_conversation: ai?.conversation ?? [],
      lead_source: leadSource,
    })
    .select("id, created_at")
    .single();

  if (error) {
    console.error(`[consultation] store failed: ${error.message}`);
    return null;
  }
  return row;
}

function htmlBody(
  data: ConsultationForm,
  createdAt: string,
  tracking?: LeadTrackingPayload,
  ai?: AiConsultationPayload,
) {
  const row = (label: string, value?: string | null) =>
    `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${esc(
      label,
    )}</td><td style="padding:6px 0">${
      value && value.trim() ? esc(value.trim()).replace(/\n/g, "<br/>") : "-"
    }</td></tr>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111"><h2 style="margin:0 0 12px">Konsultasi Baru KERJAKU</h2><table style="border-collapse:collapse;font-size:14px">${[
    row("Nama", data.name),
    row("Email", data.email),
    row("WhatsApp", data.whatsapp),
    row("Project", data.projectType),
    row("Budget", data.budget),
    row("Timeline", data.timeline),
    row("Kebutuhan", data.requirement),
    row("Fitur", data.features),
    row("Catatan", data.notes),
    row("Tanggal", createdAt),
    ...(tracking
      ? [
          row("Lead Score", `${tracking.leadScore} (${tracking.leadTemperature})`),
          row("Sumber", tracking.visitorSource),
          row("UTM", `${tracking.utmSource}/${tracking.utmMedium}/${tracking.utmCampaign}`),
          row("Referrer", tracking.referrer),
          row("Landing Page", tracking.landingPage),
          row("Halaman Dikunjungi", tracking.visitedPages.join(" > ")),
          row("Produk Dilihat", tracking.viewedProducts.join(", ")),
          row("Paket Dipilih", tracking.selectedPackage),
          row("Device", tracking.deviceType),
          row("Durasi Kunjungan", `${tracking.visitDurationSeconds} detik`),
        ]
      : []),
    ...(ai
      ? [
          row("AI — Kategori Bisnis", ai.businessCategory),
          row("AI — Masalah", ai.problems.join(", ")),
          row("AI — Kebutuhan", ai.requirements.join(", ")),
          row("AI — Rekomendasi", ai.packageName),
          row("AI — Kompleksitas", ai.complexity),
          row("AI — Skor", `${ai.score}/100 (${ai.qualification})`),
          row("AI — Ringkasan", ai.summary),
        ]
      : []),
  ].join("")}</table></div>`;
}

/**
 * Email notification to the owner through the shared email transport.
 * Best-effort: failures are logged with the provider detail, never thrown back to the form.
 */
export async function sendLeadEmail(
  data: ConsultationForm,
  createdAt: string,
  tracking?: LeadTrackingPayload,
  ai?: AiConsultationPayload,
) {
  const { sendEmail } = await import("./email.server");
  const { subject, text } = formatLeadEmail(data, createdAt, tracking, ai);
  return sendEmail(
    {
      to: [LEAD_EMAIL],
      replyTo: data.email,
      subject,
      text,
      html: htmlBody(data, createdAt, tracking, ai),
    },
    "consultation",
  );
}


