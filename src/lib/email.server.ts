// Server-only shared email transport for KERJAKU notifications.
// One service used by every consultation channel (manual form, AI consultant,
// order brief delivery) so behaviour and logging stay identical.

export type EmailResult = {
  sent: boolean;
  reason: null | "email_not_configured" | "email_send_failed";
  detail?: string;
};

export type EmailPayload = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export function emailSenderFrom() {
  return process.env["RESEND_FROM"] ?? "KERJAKU <onboarding@resend.dev>";
}

/** True when at least one Resend transport is configured. */
export function isEmailConfigured() {
  const resendKey = process.env["RESEND_API_KEY"];
  if (!resendKey) return false;
  // Direct Resend keys work alone; connector keys additionally need LOVABLE_API_KEY.
  return resendKey.startsWith("re_") ? true : Boolean(process.env["LOVABLE_API_KEY"]);
}

/**
 * Send a transactional email through Resend.
 * - A direct Resend API key (`re_...`) is sent straight to the Resend API.
 * - Any other key is treated as a Lovable connector key and routed through the gateway.
 * Never throws: always reports a structured result and logs the real cause.
 */
export async function sendEmail(payload: EmailPayload, tag = "email"): Promise<EmailResult> {
  const resendKey = process.env["RESEND_API_KEY"];
  const lovableKey = process.env["LOVABLE_API_KEY"];

  if (!resendKey) {
    const detail = "RESEND_API_KEY is not configured";
    console.error(`[${tag}] email not sent: ${detail}`);
    return { sent: false, reason: "email_not_configured", detail };
  }

  const direct = resendKey.startsWith("re_");
  if (!direct && !lovableKey) {
    const detail = "LOVABLE_API_KEY is required for the Resend connector gateway";
    console.error(`[${tag}] email not sent: ${detail}`);
    return { sent: false, reason: "email_not_configured", detail };
  }

  const url = direct
    ? "https://api.resend.com/emails"
    : "https://connector-gateway.lovable.dev/resend/emails";
  const headers: Record<string, string> = direct
    ? { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: emailSenderFrom(),
        to: payload.to,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `[${tag}] email failed [${response.status}] via ${direct ? "resend-api" : "gateway"}: ${detail}`,
      );
      return { sent: false, reason: "email_send_failed", detail };
    }

    const accepted = (await response.json().catch(() => null)) as { id?: string } | null;
    console.info(`[${tag}] email accepted by provider, id=${accepted?.id ?? "unknown"}`);
    return { sent: true, reason: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[${tag}] email threw: ${detail}`);
    return { sent: false, reason: "email_send_failed", detail };
  }
}
