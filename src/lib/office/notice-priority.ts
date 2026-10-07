export type OfficeNoticeKind = "action" | "celebration" | "informational";
export type OfficeNoticeEntry = { id: string; kind: OfficeNoticeKind; sequence: number };
const rank = { action: 0, celebration: 1, informational: 2 };

/** The approximate cap never suppresses a response-required notice. */
export function selectOfficeNotices(entries: readonly OfficeNoticeEntry[], limit = 3) {
  const sorted = [...entries].sort((a, b) => rank[a.kind] - rank[b.kind] || a.sequence - b.sequence);
  const actionCount = sorted.filter((entry) => entry.kind === "action").length;
  return sorted.slice(0, Math.max(limit, actionCount)).map((entry) => entry.id);
}