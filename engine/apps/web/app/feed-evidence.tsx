"use client";

import { useState } from "react";
import { observationLabel } from "./feed-evidence.mjs";

export { observationLabel };

type FeedLinkStatus = "connecting" | "live" | "error" | "reconnecting";

export function useObservedStatus(initial: FeedLinkStatus = "connecting") {
  const [status, setStatusOnly] = useState<FeedLinkStatus>(initial);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const setStatus = (next: FeedLinkStatus) => {
    setStatusOnly(next);
    setSeenAt(next === "live" ? Date.now() : null);
  };
  return { status, setStatus, seenAt };
}

export function EvidencePill({ status, source, seenAt }: { status: string; source: string; seenAt: number | null }) {
  const evidence = observationLabel(status, source, seenAt);
  return <span className={evidence.verified ? "pill pill-live" : "pill pill-warn"}>{evidence.text}</span>;
}
