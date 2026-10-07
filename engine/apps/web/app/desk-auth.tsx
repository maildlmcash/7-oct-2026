"use client";

import { useEffect, useRef, useState } from "react";
import { DESK_ROLE_ACCESS, isDeskRole } from "../../../services/desk-roles.mjs";

export type DeskRole = "User" | "Admin";

export type DeskSession = {
  role: DeskRole;
  loginId: string;
  csrfToken: string;
};

const DOORS = [
  { role: "User" as const, loginId: "user", password: "user-paper-1", action: "User login" },
  { role: "Admin" as const, loginId: "admin", password: "admin-paper-1", action: "Admin login" },
];

function isSession(body: { ok?: boolean; role?: string; loginId?: string; csrfToken?: string }): body is {
  ok: true;
  role: DeskRole;
  loginId: string;
  csrfToken: string;
} {
  return Boolean(body?.ok && isDeskRole(body.role) && typeof body.loginId === "string" && typeof body.csrfToken === "string");
}

export function DeskAuth({
  session,
  onSession,
}: {
  session: DeskSession | null;
  onSession: (session: DeskSession | null) => void;
}) {
  const [pending, setPending] = useState<DeskRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  useEffect(() => {
    let cancel = false;
    fetch("/api/desk/session", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!cancel && isSession(body)) onSessionRef.current({ role: body.role, loginId: body.loginId, csrfToken: body.csrfToken });
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  async function signIn(door: (typeof DOORS)[number]) {
    setPending(door.role);
    setError(null);
    try {
      const csrfResponse = await fetch("/api/desk/csrf", { cache: "no-store" });
      const csrf = await csrfResponse.json();
      if (!csrf?.ok || typeof csrf.csrfToken !== "string") {
        setError("Sign-in is unavailable.");
        return;
      }
      const response = await fetch("/api/desk/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({ loginId: door.loginId, password: door.password }),
      });
      const body = await response.json();
      if (!isSession(body) || body.role !== door.role) {
        setError(body?.error === "login denied" ? "Login denied for this role." : "Login denied.");
        return;
      }
      onSession({ role: body.role, loginId: body.loginId, csrfToken: body.csrfToken });
    } catch {
      setError("Login denied.");
    } finally {
      setPending(null);
    }
  }

  async function signOut() {
    if (!session) return;
    setPending(session.role);
    setError(null);
    try {
      await fetch("/api/desk/logout", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": session.csrfToken },
      });
    } catch {
      // Local role still clears. Admin tools need a fresh login.
    }
    onSession(null);
    setPending(null);
  }

  const active = session ? DESK_ROLE_ACCESS[session.role] : null;

  return (
    <section className="desk-auth" aria-label="Role login">
      <div className="desk-auth-head">
        <div>
          <span className="eyebrow">TWO ROLES · PAPER DESK</span>
          <h2>User role and Admin role</h2>
          <p>दोनों रोल अलग हैं। User रिसर्च देखता है। Admin वही देखता है और checklist एडिट भी कर सकता है। Live orders locked रहते हैं।</p>
        </div>
        <span className={session?.role === "Admin" ? "pill pill-live" : "pill pill-warn"}>{session ? `${session.role} role` : "Signed out"}</span>
      </div>
      {active && session ? (
        <article className="card role-card">
          <span className="eyebrow">{active.title} ROLE</span>
          <h3>{session.loginId}</h3>
          <p>{active.summary}</p>
          <p className="role-list"><b>Open</b> {active.sections.join(" · ")}</p>
          {active.denied.length > 0 ? <p className="role-list"><b>Closed</b> {active.denied.join(" · ")}</p> : <p className="role-list"><b>Closed</b> none</p>}
          <button type="button" className="button button-dark" onClick={signOut} disabled={pending !== null}>Sign out</button>
        </article>
      ) : (
        <div className="role-split">
          {DOORS.map((door) => {
            const access = DESK_ROLE_ACCESS[door.role];
            return (
              <article className="card role-card" key={door.role}>
                <span className="eyebrow">{access.title} ROLE</span>
                <h3>{access.title}</h3>
                <p>{access.summary}</p>
                <p className="role-list"><b>Open</b> {access.sections.join(" · ")}</p>
                <p className="role-list"><b>Closed</b> {access.denied.length > 0 ? access.denied.join(" · ") : "none"}</p>
                <p className="muted tiny">{door.loginId} / {door.password}</p>
                <button type="button" className={door.role === "Admin" ? "button button-dark" : "button button-accent"} onClick={() => void signIn(door)} disabled={pending !== null}>
                  {pending === door.role ? "Signing in…" : door.action}
                </button>
              </article>
            );
          })}
        </div>
      )}
      {error ? <p className="notice notice-error">{error}</p> : null}
    </section>
  );
}
