// Server-only: give MANUAL_FORM leads the same Order Brief artefacts the AI
// Consultant produces (conversation shell + conversation_requirements v1),
// so admin delivery, PDF, and short links work identically for both sources.

import type { ConsultationForm, LeadTrackingPayload } from "./consultation-schema";
import { normalizeBusiness } from "./business-name";

function splitList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n|[;•]|,(?![^()]*\))/g)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((item) => item.length > 1)
    .slice(0, 12);
}

function intentOf(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Create the Order Brief source-of-truth record for a manual-form lead.
 * Best-effort: failures are logged, the lead itself still stands.
 */
export async function createManualOrderBrief(
  leadId: string,
  form: ConsultationForm,
  tracking?: LeadTrackingPayload,
): Promise<{ version: number } | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saveRequirementVersion } = await import("./requirements.server");

    const sessionId = `manual-${leadId}`;
    const score = tracking?.leadScore ?? 0;
    const intent = intentOf(score);
    const business = normalizeBusiness(form.businessName || form.name).name;
    const problems = splitList(form.requirement);
    const features = splitList(form.features);

    const { data: existing } = await supabaseAdmin
      .from("ai_conversations")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    let conversationId = existing?.id ?? null;
    if (!conversationId) {
      const { data, error } = await supabaseAdmin
        .from("ai_conversations")
        .insert({
          session_id: sessionId,
          status: "qualified_lead",
          messages: [],
          message_count: 0,
          intent,
          business_category: business,
          problems,
          requirements: features,
          features,
          budget: form.budget,
          timeline: form.timeline,
          contact_name: form.name,
          contact_email: form.email,
          contact_whatsapp: form.whatsapp,
          summary: form.requirement,
          score,
          qualified_at: new Date().toISOString(),
          lead_id: leadId,
        })
        .select("id")
        .single();
      if (error) {
        console.error("[manual-brief] conversation insert failed", error.message);
        return null;
      }
      conversationId = data.id;
    }

    const saved = await saveRequirementVersion(conversationId, leadId, {
      business,
      project: form.projectType,
      features,
      problems,
      packageName: tracking?.selectedPackage || null,
      timeline: form.timeline,
      budget: form.budget,
      usersScale: null,
      intent,
      score,
      contactName: form.name,
      contactEmail: form.email,
      contactWhatsapp: form.whatsapp,
      summary: [form.requirement, form.notes ? `Catatan: ${form.notes}` : ""]
        .filter(Boolean)
        .join("\n"),
      source: "manual",
    });

    return saved ? { version: saved.version } : null;
  } catch (error) {
    console.error("[manual-brief] failed", (error as Error).message);
    return null;
  }
}
