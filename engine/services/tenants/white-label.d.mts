export type TenantTheme = {
  tenantId: string;
  host: string;
  subdomain: string;
  logoText: string;
  color: string;
  helpLinks: { label: string; href: string }[];
  featureFlags: {
    help: boolean;
    paperPreview: true;
    liveTrading: false;
    liveOrdersLocked: true;
    walletAccess: false;
    exchangeCredentials: false;
  };
};

export type TenantResolution = {
  ok: boolean;
  error: string | null;
  pathname: "/app";
  theme: TenantTheme | null;
};

export function resolveTenantHost(
  input?: {
    host?: string | null;
    forwardedHost?: string | null;
    originalHost?: string | null;
    requestedTenantId?: string;
    userTenantId?: string;
    userSubdomain?: string;
  },
  registry?: readonly unknown[],
): TenantResolution;

export function approvedPreviews(): TenantResolution[];
