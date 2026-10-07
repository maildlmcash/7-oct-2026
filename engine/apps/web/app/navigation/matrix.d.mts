export const NAV_DENIAL: "role scope denied";
export const PREVIEW_BANNER: "Preview only. The signed-in role stays Super Admin.";
export const COMBINED_PREVIEW: "Retailer and Customer";

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

export function navigationFromSession(
  session: unknown,
  options?: { previewRole?: string },
): RoleNavigationModel;
