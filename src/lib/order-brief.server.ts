// Server-only Order Brief delivery: load brief data, send email with PDF, log history.
import type { OrderBriefData } from "./order-brief";

type Client = {
  from: (table: string) => any;
};

/** Map the latest requirement version of a conversation into Order Brief data. */
export async function loadOrderBrief(
  supabase: Client,
  conversationId: string,
): Promise<{ brief: OrderBriefData; leadId: string | null; conversationId: string } | null> {
  const { data, error } = await supabase
    .from("conversation_requirements")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const asArray = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item)) : [];

  const brief: OrderBriefData = {
    version: Number(row["version"] ?? 1),
    customerName: (row["contact_name"] as string) || "Customer",
    whatsapp: (row["contact_whatsapp"] as string) ?? null,
    email: (row["contact_email"] as string) ?? null,
    business: (row["business"] as string) ?? "",
    project: (row["project"] as string) ?? "",
    goal: (row["summary"] as string) ?? null,
    problems: asArray(row["problems"]),
    usersScale: (row["users_scale"] as string) ?? null,
    adminNeeds: (row["change_note"] as string) ?? null,
    features: asArray(row["features"]),
    timeline: (row["timeline"] as string) ?? null,
    budget: (row["budget"] as string) ?? null,
    recommendation: (row["package_name"] as string) ?? null,
    source: (row["source"] as "ai" | "manual") ?? "ai",
    createdAt: (row["created_at"] as string) ?? new Date().toISOString(),
  };

  return {
    brief,
    leadId: (row["lead_id"] as string) ?? null,
    conversationId,
  };
}

/** Same mapping, but resolved from the CRM lead id instead of a conversation. */
export async function loadOrderBriefByLead(
  supabase: Client,
  leadId: string,
): Promise<{ brief: OrderBriefData; leadId: string | null; conversationId: string } | null> {
  const { data, error } = await supabase
    .from("conversation_requirements")
    .select("conversation_id")
    .eq("lead_id", leadId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.conversation_id) return null;
  return loadOrderBrief(supabase, data.conversation_id as string);
}

/** Resolve a brief from either a conversation id or a CRM lead id. */
export async function loadOrderBriefFor(
  supabase: Client,
  target: { conversationId?: string; leadId?: string },
) {
  if (target.conversationId) return loadOrderBrief(supabase, target.conversationId);
  if (target.leadId) return loadOrderBriefByLead(supabase, target.leadId);
  return null;
}

function htmlFromMessage(message: string) {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.6">${esc(
    message,
  ).replace(/\n/g, "<br/>")}</div>`;
}

/** Public base URL used for short download links. */
export function publicSiteUrl() {
  const raw = process.env["PUBLIC_SITE_URL"] ?? "https://kerjaku.space";
  return raw.replace(/\/+$/, "");
}

/** "Order_Brief_KERJAKU_Candra.pdf" → "order-brief-kerjaku-candra" */
export function slugFromFileName(fileName: string) {
  return (
    fileName
      .replace(/\.pdf$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "order-brief-kerjaku"
  );
}

/**
 * Register (or refresh) a readable short link that points at a stored PDF.
 * The short link never expires: the signed URL is minted when it is opened.
 */
export async function createDocumentShortLink(input: {
  base: string;
  kind?: string;
  bucket?: string;
  path: string;
  fileName: string;
  leadId?: string | null;
  conversationId?: string | null;
  createdBy?: string | null;
}): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (table: string) => any };
    const bucket = input.bucket ?? "order-briefs";
    const row = {
      kind: input.kind ?? "order-brief",
      bucket,
      path: input.path,
      file_name: input.fileName,
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null,
      created_by: input.createdBy ?? null,
    };

    // Reuse the same slug for the same lead/document so customers keep one link.
    const { data: existing } = await admin
      .from("document_links")
      .select("slug")
      .eq("file_name", input.fileName)
      .eq("lead_id", input.leadId ?? null)
      .limit(1)
      .maybeSingle();

    if (existing?.slug) {
      await admin
        .from("document_links")
        .update({ path: input.path, bucket })
        .eq("slug", existing.slug);
      return existing.slug as string;
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const slug =
        attempt === 0
          ? input.base
          : `${input.base}-${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await admin.from("document_links").insert({ ...row, slug });
      if (!error) return slug;
      if (!String(error.message ?? "").includes("duplicate")) return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Resolve a short slug into a fresh signed storage URL (forces download). */
export async function resolveDocumentShortLink(slug: string) {
  const detail = await resolveDocumentShortLinkDetail(slug);
  return detail?.downloadUrl ?? null;
}

/** Resolve a short slug into inline-view + download signed URLs. */
export async function resolveDocumentShortLinkDetail(slug: string): Promise<{
  fileName: string;
  viewUrl: string;
  downloadUrl: string;
} | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as { from: (table: string) => any; storage: any };
  const { data } = await admin
    .from("document_links")
    .select("bucket, path, file_name")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;

  const storage = admin.storage.from(data.bucket as string);
  const fileName = (data.file_name as string) ?? "dokumen.pdf";
  const [view, download] = await Promise.all([
    storage.createSignedUrl(data.path as string, 60 * 60),
    storage.createSignedUrl(data.path as string, 60 * 60, { download: fileName }),
  ]);
  const viewUrl = (view?.data?.signedUrl as string) ?? null;
  const downloadUrl = (download?.data?.signedUrl as string) ?? viewUrl;
  if (!viewUrl) return null;
  return { fileName, viewUrl, downloadUrl };
}


/** Upload the generated PDF to private storage and return a clean short link. */
export async function uploadOrderBriefPdf(input: {
  leadId: string | null;
  conversationId?: string | null;
  fileName: string;
  bytes: Uint8Array;
  createdBy?: string | null;
}): Promise<{ url: string | null; path: string | null; reason: string | null }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const storage = (supabaseAdmin as unknown as { storage: any }).storage.from("order-briefs");
    const folder = input.leadId ?? input.conversationId ?? "misc";
    const path = `${folder}/${Date.now()}-${input.fileName}`;
    const { error } = await storage.upload(path, input.bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) return { url: null, path: null, reason: error.message };

    const slug = await createDocumentShortLink({
      base: slugFromFileName(input.fileName),
      path,
      fileName: input.fileName,
      leadId: input.leadId,
      conversationId: input.conversationId ?? null,
      createdBy: input.createdBy ?? null,
    });
    if (slug) return { url: `${publicSiteUrl()}/d/${slug}`, path, reason: null };

    // Fallback: signed URL if the short link could not be registered.
    const { data, error: signError } = await storage.createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError) return { url: null, path, reason: signError.message };
    return { url: (data?.signedUrl as string) ?? null, path, reason: null };
  } catch (error) {
    return {
      url: null,
      path: null,
      reason: error instanceof Error ? error.message : "storage_failed",
    };
  }
}


/** Send the Order Brief to the customer via Resend with the PDF attached. */
export async function sendOrderBriefEmail(input: {
  to: string;
  subject: string;
  message: string;
  fileName: string;
  pdfBase64: string;
}): Promise<{ sent: boolean; reason: string | null }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) {
    return { sent: false, reason: "Email belum dikonfigurasi (RESEND_API_KEY tidak tersedia)." };
  }
  const from = process.env["RESEND_FROM"] ?? "KERJAKU <noreply@kerjaku.space>";

  try {
    const response = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.message,
        html: htmlFromMessage(input.message),
        attachments: [
          {
            filename: input.fileName,
            content: input.pdfBase64,
            content_type: "application/pdf",
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(`[order-brief] email failed [${response.status}]: ${detail}`);
      let message = detail;
      try {
        const parsed = JSON.parse(detail) as { message?: string; error?: string };
        message = parsed.message ?? parsed.error ?? detail;
      } catch {
        /* keep raw text */
      }
      if (response.status === 403) {
        message = `${message} — domain pengirim belum terverifikasi di Resend. Verifikasi domain kerjaku.space di Resend (DNS: SPF, DKIM, DMARC) lalu set RESEND_FROM, contoh: KERJAKU <noreply@kerjaku.space>. Sementara itu gunakan tombol Copy Email / Copy Link PDF / Copy Message untuk kirim manual.`;
      }
      return { sent: false, reason: `[${response.status}] ${message}`.slice(0, 400) };
    }
    return { sent: true, reason: null };
  } catch (error) {
    console.error(
      `[order-brief] email threw: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { sent: false, reason: error instanceof Error ? error.message : "email_send_failed" };
  }
}


/** Save an edited Order Brief as a NEW version (previous versions are kept). */
export async function saveOrderBriefVersion(
  supabase: Client,
  input: {
    conversationId: string;
    leadId: string | null;
    base: OrderBriefData;
    next: OrderBriefData;
    createdBy: string | null;
  },
): Promise<{ version: number }> {
  const version = Number(input.base.version || 1) + 1;
  const { error } = await (supabase as any).from("conversation_requirements").insert({
    conversation_id: input.conversationId,
    lead_id: input.leadId,
    version,
    business: input.next.business,
    project: input.next.project,
    features: input.next.features,
    problems: input.next.problems,
    package_name: input.next.recommendation,
    timeline: input.next.timeline,
    budget: input.next.budget,
    users_scale: input.next.usersScale,
    intent: "qualified",
    score: 0,
    contact_name: input.next.customerName,
    contact_email: input.next.email,
    contact_whatsapp: input.next.whatsapp,
    summary: input.next.goal,
    change_note: input.next.adminNeeds,
    source: "admin_edit",
    created_by: input.createdBy,
  });
  if (error) throw new Error(error.message);
  return { version };
}


/** Generic PDF upload + short link (Proposal, Invoice, Quotation, Report). */
export async function uploadDocumentPdf(input: {
  kind: string;
  slugBase: string;
  folder: string;
  fileName: string;
  bytes: Uint8Array;
  leadId?: string | null;
  createdBy?: string | null;
  /** Public route prefix for the short link ("d" for documents, "i" for invoices). */
  linkPath?: string;
}): Promise<{ url: string | null; path: string | null; reason: string | null }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const storage = (supabaseAdmin as unknown as { storage: any }).storage.from("order-briefs");
    const path = `${input.kind}/${input.folder}/${Date.now()}-${input.fileName}`;
    const { error } = await storage.upload(path, input.bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) return { url: null, path: null, reason: error.message };

    const slug = await createDocumentShortLink({
      base: input.slugBase,
      kind: input.kind,
      path,
      fileName: input.fileName,
      leadId: input.leadId ?? null,
      createdBy: input.createdBy ?? null,
    });
    if (slug) {
      return { url: `${publicSiteUrl()}/${input.linkPath ?? "d"}/${slug}`, path, reason: null };
    }

    const { data, error: signError } = await storage.createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError) return { url: null, path, reason: signError.message };
    return { url: (data?.signedUrl as string) ?? null, path, reason: null };
  } catch (error) {
    return {
      url: null,
      path: null,
      reason: error instanceof Error ? error.message : "storage_failed",
    };
  }
}
