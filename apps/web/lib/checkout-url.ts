export function normalizeStoreUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** One URL per line, or comma-separated. Dedupes and normalizes. */
export function parseBulkUrls(text: string, max = 100): string[] {
  const parts = text.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const normalized = normalizeStoreUrl(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
}
