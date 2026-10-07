"use client";

import { useState } from "react";
import { COMBINED_PREVIEW, PREVIEW_BANNER } from "./matrix.mjs";

export type RoleNavRow = { id: string; label: string };

export type RoleNavView = {
  screens: readonly string[];
  disabled: readonly RoleNavRow[];
};

export type RoleNavigationModel = {
  ok: boolean;
  error: string | null;
  authenticated: boolean;
  sessionRoles: readonly string[];
  canPreview: boolean;
  impersonation: false;
  screens: readonly string[];
  disabled: readonly RoleNavRow[];
  denial: string;
  previews: Record<string, RoleNavView> | null;
};

export function RoleNav({
  model,
  onOpen,
}: {
  model: RoleNavigationModel | null;
  onOpen?: (screen: string) => void;
}) {
  const [previewKey, setPreviewKey] = useState("");
  if (!model?.authenticated) return null;
  if (!model.ok) {
    return (
      <nav className="role-nav" aria-label="Role access" data-impersonation="false" data-preview="false">
        <p data-denial="session">{model.error}</p>
      </nav>
    );
  }
  const preview = model.canPreview && previewKey !== "" ? model.previews?.[previewKey] : null;
  const screens = preview ? preview.screens : model.screens;
  const disabled = preview ? preview.disabled : model.disabled;
  const signedIn = model.sessionRoles.join(" and ");
  return (
    <nav className="role-nav" aria-label="Role access" data-impersonation="false" data-preview={preview ? "true" : "false"}>
      <p data-session-role={signedIn}>{signedIn}</p>
      {preview ? <p data-preview-banner="true">{PREVIEW_BANNER}</p> : null}
      {model.canPreview ? (
        <label>
          Role preview
          <select
            aria-label="Role preview"
            value={previewKey}
            onChange={(event) => setPreviewKey(event.target.value)}
          >
            <option value="">Signed-in role</option>
            {Object.keys(model.previews ?? {}).map((key) => (
              <option key={key} value={key}>{key === COMBINED_PREVIEW ? COMBINED_PREVIEW : key}</option>
            ))}
          </select>
        </label>
      ) : null}
      {screens.map((screen) => (
        <button key={screen} type="button" data-screen={screen} onClick={() => onOpen?.(screen)}>
          {screen}
        </button>
      ))}
      {disabled.map((row) => (
        <span key={row.id}>
          <button type="button" data-action={row.id} disabled>{row.label}</button>
          <p data-denial={row.id}>{model.denial}</p>
        </span>
      ))}
    </nav>
  );
}
