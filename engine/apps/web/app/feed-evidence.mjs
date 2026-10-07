// A LIVE label is allowed only with a source string and an ISO-8601 last-seen time.
// Anything else stays unverified. This file does not invent a timestamp.

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function observationLabel(status, source, seenAt) {
  const sourceText = typeof source === "string" ? source.trim() : "";
  const stamp = typeof seenAt === "number" && Number.isFinite(seenAt) ? new Date(seenAt).toISOString() : "";
  if (status === "live" && sourceText.length > 0 && ISO_TIME.test(stamp)) {
    return { text: `LIVE · ${sourceText} · ${stamp}`, verified: true };
  }
  if (status === "error") return { text: "ERROR", verified: false };
  if (status === "connecting") return { text: "CONNECTING", verified: false };
  if (status === "reconnecting") return { text: "RECONNECTING", verified: false };
  return { text: "NOT VERIFIED", verified: false };
}
