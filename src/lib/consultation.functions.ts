import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { consultationSubmissionSchema } from "./consultation-schema";

/**
 * Accepts a consultation lead: validates server-side, screens for spam
 * (honeypot + per-IP rate limit), stores it, then notifies via Telegram and
 * email. Notifications are best-effort — a stored submission still succeeds
 * if a notification channel fails.
 */
export const submitConsultationLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => consultationSubmissionSchema.parse(data))
  .handler(async ({ data }) => {
    const { checkSpam } = await import("./spam-guard.server");

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const verdict = checkSpam({ ip, honeypot: data.honeypot, elapsedMs: data.elapsedMs });
    if (!verdict.ok) {
      if (verdict.reason === "rate_limited") {
        throw new Error("Terlalu banyak pengiriman. Coba lagi beberapa menit lagi.");
      }
      // Silently accept bot traffic without storing or notifying.
      return {
        success: true as const,
        stored: false,
        notifiedTelegram: false,
        notifiedEmail: false,
        leadScore: 0,
        leadTemperature: "Cold Lead" as const,
      };
    }

    const { storeConsultation, sendLeadEmail, formatLeadTelegram } =
      await import("./consultation.server");

    const { form, tracking, ai, leadSource } = data;
    const row = await storeConsultation(form, tracking, ai, leadSource);
    const createdAt = new Date(row?.created_at ?? Date.now()).toISOString();

    // Same engine output as the AI Consultant: Lead -> Order Brief -> Notification.
    let notified = { telegram: false, email: false };
    if (row?.id) {
      const { createManualOrderBrief } = await import("./manual-brief.server");
      await createManualOrderBrief(row.id, form, tracking);

      const { notifyLeadFromCrm } = await import("./lead-notify.server");
      notified = await notifyLeadFromCrm(row.id);
    } else {
      // Storage failed: fall back to the direct notification path.
      const { sendTelegramMessage } = await import("./telegram.server");
      const telegram = await sendTelegramMessage(
        formatLeadTelegram(form, createdAt, tracking, ai),
      );
      const email = await sendLeadEmail(form, createdAt, tracking, ai);
      notified = { telegram: telegram.ok, email: email.sent };
    }

    const { runAutomation } = await import("./automation.server");
    await runAutomation({
      type: "lead.created",
      leadId: row?.id ?? null,
      name: form.name,
      contact: form.whatsapp || form.email,
      projectType: form.projectType,
      budget: form.budget,
      score: ai?.score ?? tracking?.leadScore ?? 0,
      temperature: tracking?.leadTemperature ?? "Cold Lead",
      source: leadSource,
    });

    return {
      success: true as const,
      stored: Boolean(row),
      notifiedTelegram: notified.telegram,
      notifiedEmail: notified.email,
      leadScore: tracking?.leadScore ?? 0,
      leadTemperature: tracking?.leadTemperature ?? "Cold Lead",
    };
  });
