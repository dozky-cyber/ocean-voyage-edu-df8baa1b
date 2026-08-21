// Server-only: notifications built from the SAME CRM lead record shown in the
// dashboard. No chat parsing, no regeneration — one source of truth.

import { LEAD_EMAIL } from "./consultation.server";
import { escapeHtml, sendTelegramMessage } from "./telegram.server";

type LeadRecord = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  project_type: string | null;
  requirement: string | null;
  budget: string | null;
  timeline: string | null;
  business_name: string | null;
  features: string | null;
  notes: string | null;
  ai_summary: string | null;
  ai_problems: unknown;
  ai_requirements: unknown;
  created_at: string;
};

const PLACEHOLDER_EMAIL = /@leads\.kerjaku\.space$/i;

function clean(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "-") return "";
  return trimmed;
}

function listOf(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(", ");
  return "";
}

function fieldsOf(lead: LeadRecord) {
  const email = clean(lead.email);
  return {
    name: clean(lead.name),
    email: PLACEHOLDER_EMAIL.test(email) ? "" : email,
    whatsapp: clean(lead.whatsapp),
    business: clean(lead.business_name),
    project: clean(lead.project_type),
    goal: clean(lead.requirement),
    problems: listOf(lead.ai_problems),
    features: clean(lead.features) || listOf(lead.ai_requirements),
    timeline: clean(lead.timeline),
    budget: clean(lead.budget),
    summary: clean(lead.ai_summary),
  };
}

function orDash(value: string) {
  return value || "-";
}

function emailText(f: ReturnType<typeof fieldsOf>) {
  return [
    "Konsultasi Baru KERJAKU",
    "",
    `Nama:\n${orDash(f.name)}`,
    "",
    `Email:\n${orDash(f.email)}`,
    "",
    `WhatsApp:\n${orDash(f.whatsapp)}`,
    "",
    `Business:\n${orDash(f.business)}`,
    "",
    `Project:\n${orDash(f.project)}`,
    "",
    `Budget:\n${orDash(f.budget)}`,
    "",
    `Timeline:\n${orDash(f.timeline)}`,
    "",
    `Kebutuhan:\n${orDash(f.goal)}`,
    "",
    `Masalah:\n${orDash(f.problems)}`,
    "",
    `Fitur:\n${orDash(f.features)}`,
    "",
    `Ringkasan AI:\n${orDash(f.summary)}`,
  ].join("\n");
}

function emailHtml(f: ReturnType<typeof fieldsOf>) {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${escapeHtml(
      label,
    )}</td><td style="padding:6px 0">${escapeHtml(orDash(value)).replace(/\n/g, "<br/>")}</td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111"><h2 style="margin:0 0 12px">Konsultasi Baru KERJAKU</h2><table style="border-collapse:collapse;font-size:14px">${[
    row("Nama", f.name),
    row("Email", f.email),
    row("WhatsApp", f.whatsapp),
    row("Business", f.business),
    row("Project", f.project),
    row("Budget", f.budget),
    row("Timeline", f.timeline),
    row("Kebutuhan", f.goal),
    row("Masalah", f.problems),
    row("Fitur", f.features),
    row("Ringkasan AI", f.summary),
  ].join("")}</table></div>`;
}

function telegramText(f: ReturnType<typeof fieldsOf>) {
  const row = (label: string, value: string) =>
    `<b>${label}:</b>\n${escapeHtml(orDash(value))}`;
  return [
    "🤖 <b>NEW AI CONSULTANT LEAD</b>",
    "",
    row("Nama", f.name),
    "",
    row("WhatsApp", f.whatsapp),
    "",
    row("Email", f.email),
    "",
    row("Business", f.business),
    "",
    row("Project", f.project),
    "",
    row("Budget", f.budget),
    "",
    row("Timeline", f.timeline),
    "",
    row("Kebutuhan", f.goal),
    "",
    row("Masalah", f.problems),
    "",
    row("Fitur", f.features),
    "",
    row("Ringkasan AI", f.summary),
  ].join("\n");
}

async function sendLeadNotificationEmail(f: ReturnType<typeof fieldsOf>) {
  const { sendEmail } = await import("./email.server");
  const result = await sendEmail(
    {
      to: [LEAD_EMAIL],
      ...(f.email ? { replyTo: f.email } : {}),
      subject: `[Konsultasi KERJAKU] Project Baru - ${f.name || "Prospek AI"}`,
      text: emailText(f),
      html: emailHtml(f),
    },
    "lead-notify",
  );
  return result.sent;
}


/**
 * Notify admin (email + Telegram) using the stored CRM lead record.
 * Best-effort: failures are logged only.
 */
export async function notifyLeadFromCrm(leadId: string) {
  if (!leadId) return { email: false, telegram: false };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("consultations")
    .select(
      "id, name, email, whatsapp, project_type, requirement, budget, timeline, business_name, features, notes, ai_summary, ai_problems, ai_requirements, created_at",
    )
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) {
    console.error("[lead-notify] lead read failed", error?.message ?? "not found");
    return { email: false, telegram: false };
  }

  const fields = fieldsOf(data as LeadRecord);
  const [email, telegram] = await Promise.all([
    sendLeadNotificationEmail(fields),
    sendTelegramMessage(telegramText(fields)).then((result) => result.ok),
  ]);
  return { email, telegram };
}
