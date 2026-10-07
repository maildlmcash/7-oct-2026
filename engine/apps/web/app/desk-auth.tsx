"use client";

import { useEffect, useRef, useState } from "react";

export type DeskRole = "Customer" | "Admin";

export type DeskSession = {
  role: DeskRole;
  loginId: string;
  csrfToken: string;
};

const PRESETS = [
  { id: "user", label: "User login", hint: "यूजर · Customer", loginId: "user", password: "user-paper-1" },
  { id: "admin", label: "Admin login", hint: "एडमिन · Admin", loginId: "admin", password: "admin-paper-1" },
] as const;

export function DeskAuth({
  session,
  onSession,
}: {
  session: DeskSession | null;
  onSession: (session: DeskSession | null) => void;
}) {
  const [loginId, setLoginId] = useState(PRESETS[0].loginId);
  const [password, setPassword] = useState(PRESETS[0].password);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  useEffect(() => {
    let cancel = false;
    fetch("/api/desk/session", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (cancel || !body?.ok || (body.role !== "Customer" && body.role !== "Admin")) return;
        if (typeof body.loginId !== "string" || typeof body.csrfToken !== "string") return;
        onSessionRef.current({ role: body.role, loginId: body.loginId, csrfToken: body.csrfToken });
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  async function signIn(nextId: string, nextPassword: string) {
    setPending(true);
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
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrfToken,
        },
        body: JSON.stringify({ loginId: nextId, password: nextPassword }),
      });
      const body = await response.json();
      if (!body?.ok || (body.role !== "Customer" && body.role !== "Admin") || typeof body.csrfToken !== "string") {
        setError(body?.error === "login denied" ? "Login denied. Check the role password." : "Login denied.");
        return;
      }
      onSession({ role: body.role, loginId: body.loginId, csrfToken: body.csrfToken });
    } catch {
      setError("Login denied.");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    if (!session) return;
    setPending(true);
    setError(null);
    try {
      await fetch("/api/desk/logout", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": session.csrfToken },
      });
    } catch {
      // The local role still clears. A stale cookie cannot open admin tools without a fresh login.
    }
    onSession(null);
    setPending(false);
  }

  return (
    <section className="card desk-auth" aria-label="Role login">
      <div className="desk-auth-head">
        <div>
          <span className="eyebrow">ROLE ACCESS · PAPER DESK</span>
          <h2>User and admin login</h2>
          <p>यूजर लॉगिन Customer है। एडमिन लॉगिन Admin है। Live orders locked रहते हैं।</p>
        </div>
        <span className={session ? "pill pill-live" : "pill pill-warn"}>{session ? session.role : "Signed out"}</span>
      </div>
      {session ? (
        <div className="desk-auth-row">
          <b>{session.loginId}</b>
          <span className="muted">{session.role === "Admin" ? "Admin tools unlocked" : "Customer · admin sections hidden"}</span>
          <button type="button" className="button button-dark" onClick={signOut} disabled={pending}>Sign out</button>
        </div>
      ) : (
        <form
          className="desk-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(loginId, password);
          }}
        >
          <div className="desk-auth-roles" role="group" aria-label="Choose role">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={loginId === preset.loginId}
                onClick={() => {
                  setLoginId(preset.loginId);
                  setPassword(preset.password);
                  void signIn(preset.loginId, preset.password);
                }}
                disabled={pending}
              >
                {preset.label}
                <small>{preset.hint}</small>
              </button>
            ))}
          </div>
          <label>Login id
            <input value={loginId} autoComplete="username" onChange={(event) => setLoginId(event.target.value)} />
          </label>
          <label>Password
            <input type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" className="button button-accent" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          {error ? <p className="notice notice-error">{error}</p> : <p className="muted tiny">user / user-paper-1 · admin / admin-paper-1</p>}
        </form>
      )}
    </section>
  );
}
