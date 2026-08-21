// Server-only persistence for public AI Consultant conversations.
// Every conversation is stored as a draft first; it only becomes a lead once
// the AI detects a real project intent (one lead per session, never duplicated).

import { normalizeBusiness } from "./business-name";

export type ConversationTurn = { role: "user" | "assistant"; text: string };

export type QualificationInput = {
  businessCategory: string;
  problems: string[];
  requirements: string[];
  features: string[];
  packageName: string;
  complexity: "Low" | "Medium" | "High";
  budget: string;
  timeline: string;
  users: string;
  intent: "low" | "medium" | "high";
  summary: string;
  projectType?: string;
  goal?: string;
  adminNeeds?: string;
  contactName?: string;
  contactEmail?: string;
  contactWhatsapp?: string;
};

const projectTypeByPackage: Record<string, string> = {
  "Basic System": "Website Company Profile",
  "Professional System": "Website Bisnis",
  "Digital Workflow Solution": "Dashboard Sistem",
  "Enterprise Digital Transformation": "Aplikasi Custom",
};

export function scoreConversation(input: QualificationInput): number {
  const complexity = input.complexity === "High" ? 22 : input.complexity === "Medium" ? 14 : 8;
  const intent = input.intent === "high" ? 24 : input.intent === "medium" ? 14 : 6;
  const known = (value: string) => (value && !/belum|tidak tahu|^-$/i.test(value) ? 12 : 4);
  return Math.min(
    100,
    12 +
      complexity +
      intent +
      known(input.budget) +
      known(input.timeline) +
      Math.min(12, input.requirements.length * 4) +
      Math.min(10, input.problems.length * 3),
  );
}

export function qualificationOf(score: number) {
  return score >= 70 ? "Hot Lead" : score >= 40 ? "Warm Lead" : "Cold Lead";
}

/**
 * Validate sessionId format and presence.
 * Prevents empty/null session IDs from causing isolation bypass.
 */
function validateSessionId(sessionId: string | null | undefined): sessionId is string {
  return typeof sessionId === "string" && sessionId.trim().length > 0;
}

/** Insert or update the draft conversation for a session. */
export async function saveDraftConversation(sessionId: string, turns: ConversationTurn[]) {
  if (!validateSessionId(sessionId)) {
    console.warn("[ai-conversation] invalid sessionId");
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const trimmed = turns.slice(-40).map((turn) => ({
    role: turn.role,
    text: turn.text.slice(0, 4000),
  }));

  // ✅ FIX: Enforce session_id filter on read
  const { data: existing, error: readError } = await supabaseAdmin
    .from("ai_conversations")
    .select("id, status")
    .eq("session_id", sessionId)
    .maybeSingle();
  
  if (readError) {
    console.error("[ai-conversation] read failed", readError.message);
    return;
  }

  if (!existing) {
    const { error } = await supabaseAdmin.from("ai_conversations").insert({
      session_id: sessionId,
      status: "draft",
      messages: trimmed,
      message_count: trimmed.length,
    });
    if (error) console.error("[ai-conversation] insert failed", error.message);
    return;
  }

  // ✅ FIX: Enforce session_id in update filter to prevent cross-session writes
  const { error } = await supabaseAdmin
    .from("ai_conversations")
    .update({ messages: trimmed, message_count: trimmed.length })
    .eq("id", existing.id)
    .eq("session_id", sessionId);
  
  if (error) console.error("[ai-conversation] update failed", error.message);
}

/**
 * Promote a draft conversation to a qualified lead.
 * Reuses the existing lead when the same session qualifies again.
 */
export async function qualifyConversation(
  sessionId: string,
  input: QualificationInput,
  turns: ConversationTurn[],
) {
  if (!validateSessionId(sessionId)) {
    console.warn("[ai-conversation] invalid sessionId");
    return { ok: false as const };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const score = scoreConversation(input);
  const business = normalizeBusiness(input.businessCategory);
  const qualification = qualificationOf(score);

  await saveDraftConversation(sessionId, turns);

  // ✅ FIX: Enforce session_id filter to load only this session's conversation
  const { data: conversation } = await supabaseAdmin
    .from("ai_conversations")
    .select("id, lead_id")
    .eq("session_id", sessionId)
    .maybeSingle();

  // ✅ FIX: Abort if conversation doesn't exist for this session
  if (!conversation) {
    console.error("[ai-conversation] conversation not found for session", {
      sessionId,
    });
    return { ok: false as const };
  }

  const leadPayload = {
    name: input.contactName?.trim() || `Prospek AI · ${input.businessCategory || "Umum"}`,
    email: input.contactEmail?.trim() || `ai-${sessionId.slice(0, 12)}@leads.kerjaku.space`,
    whatsapp: input.contactWhatsapp?.trim() || "-",
    project_type: input.projectType?.trim() || projectTypeByPackage[input.packageName] || "Lainnya",
    requirement: input.summary,
    budget: input.budget || "Belum ditentukan",
    timeline: input.timeline || "Belum ditentukan",
    business_name: business.name || null,
    features: input.features.join(", "),
    notes: [
      `Skala pengguna: ${input.users || "-"}`,
      `Tujuan: ${input.goal || "-"}`,
      `Kebutuhan admin/team: ${input.adminNeeds || "-"}`,
    ].join("\n"),
    lead_source: "ai_consultant",
    ai_summary: input.summary,
    ai_recommended_package: input.packageName,
    ai_business_category: input.businessCategory,
    ai_problems: input.problems,
    ai_requirements: input.requirements,
    ai_lead_score: score,
    ai_qualification_status: qualification,
    ai_complexity: input.complexity,
    ai_conversation: turns.slice(-40),
    // CRM mirrors the AI qualification so the dashboard shows the same score/temperature.
    lead_score: score,
    lead_temperature: qualification,

  };

  let leadId = conversation?.lead_id ?? null;
  const isNewLead = !leadId;
  if (leadId) {
    const { error } = await supabaseAdmin
      .from("consultations")
      .update(leadPayload)
      .eq("id", leadId);
    if (error) console.error("[ai-conversation] lead update failed", error.message);
  } else {
    const { data, error } = await supabaseAdmin
      .from("consultations")
      .insert(leadPayload)
      .select("id")
      .single();
    if (error) {
      console.error("[ai-conversation] lead insert failed", error.message);
      return { ok: false as const };
    }
    leadId = data.id;
  }

  // Notify admin straight from the stored CRM record (same data as dashboard).
  if (isNewLead && leadId) {
    const { notifyLeadFromCrm } = await import("./lead-notify.server");
    await notifyLeadFromCrm(leadId);
  }


  let requirementVersion: number | null = null;

  if (conversation) {
    // ✅ FIX: Enforce session_id in update filter to prevent orphaned writes to other sessions
    const { error } = await supabaseAdmin
      .from("ai_conversations")
      .update({
        status: "qualified_lead",
        intent: input.intent,
        business_category: input.businessCategory,
        problems: input.problems,
        requirements: input.requirements,
        features: input.features,
        package_name: input.packageName,
        complexity: input.complexity,
        budget: input.budget,
        timeline: input.timeline,
        users_scale: input.users,
        contact_name: input.contactName ?? null,
        contact_email: input.contactEmail ?? null,
        contact_whatsapp: input.contactWhatsapp ?? null,
        summary: input.summary,
        score,
        qualified_at: new Date().toISOString(),
        lead_id: leadId,
      })
      .eq("id", conversation.id)
      .eq("session_id", sessionId);
    
    if (error) console.error("[ai-conversation] qualify failed", error.message);

    const { saveRequirementVersion } = await import("@/lib/requirements.server");
    const saved = await saveRequirementVersion(conversation.id, leadId, {
      business: business.name,
      project: input.projectType?.trim() || projectTypeByPackage[input.packageName] || "Lainnya",
      features: input.features,
      problems: input.problems,
      packageName: input.packageName,
      timeline: input.timeline,
      budget: input.budget,
      usersScale: input.users,
      intent: input.intent,
      score,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactWhatsapp: input.contactWhatsapp ?? null,
      summary: [
        input.summary,
        input.goal ? `Tujuan: ${input.goal}` : "",
        input.adminNeeds ? `Kebutuhan admin/team: ${input.adminNeeds}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      source: "ai",
    });
    requirementVersion = saved?.version ?? null;
  }

  return {
    ok: true as const,
    leadId,
    score,
    qualification,
    isNew: !conversation?.lead_id,
    requirementVersion,
    project: input.projectType?.trim() || projectTypeByPackage[input.packageName] || "Lainnya",
  };
}

export function formatQualifiedTelegram(input: QualificationInput, score: number) {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (label: string, value?: string) =>
    `<b>${label}:</b>\n${value && value.trim() ? esc(value.trim()) : "-"}`;
  return [
    "🤖 <b>QUALIFIED LEAD DARI AI CONSULTANT</b>",
    "",
    row("Bisnis", input.businessCategory),
    "",
    row("Kebutuhan", input.requirements.join(", ")),
    "",
    row("Masalah", input.problems.join(", ")),
    "",
    row("Fitur", input.features.join(", ")),
    "",
    row("Paket", input.packageName),
    "",
    row("Timeline", input.timeline),
    "",
    row("Budget", input.budget),
    "",
    `<b>Intent:</b> ${esc(input.intent)} · <b>Score:</b> ${score}/100 (${esc(qualificationOf(score))})`,
    "",
    row("Kontak", [input.contactName, input.contactWhatsapp, input.contactEmail].filter(Boolean).join(" · ")),
    "",
    row("Ringkasan AI", input.summary),
  ].join("\n");
}
