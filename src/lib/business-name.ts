// Client-safe normalisation for the business field so Manual Form and AI
// Consultant leads store/display the SAME value: the customer's business name.
// The AI category (e.g. "Laundry") stays available as metadata.

export type NormalizedBusiness = { name: string; category: string | null };

/**
 * "Laundry (Laundry Express)" -> { name: "Laundry Express", category: "Laundry" }
 * "Laundry Express"           -> { name: "Laundry Express", category: null }
 */
export function normalizeBusiness(raw: string | null | undefined): NormalizedBusiness {
  const value = (raw ?? "").trim();
  if (!value || value === "-") return { name: "", category: null };

  const match = value.match(/^(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$/);
  if (match) {
    const outside = match[1]?.trim() ?? "";
    const inside = match[2]?.trim() ?? "";
    if (inside) return { name: inside, category: outside || null };
  }
  return { name: value, category: null };
}

/** Shorthand: the display/storage business name only. */
export function normalizeBusinessName(raw: string | null | undefined): string {
  return normalizeBusiness(raw).name;
}
