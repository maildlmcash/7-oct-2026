type HelpLink = { label: string; href: string };

type ThemeFlags = {
  help: boolean;
  paperPreview: true;
  liveTrading: false;
  liveOrdersLocked: true;
  walletAccess: false;
  exchangeCredentials: false;
};

export type TenantTheme = {
  tenantId: string;
  host: string;
  subdomain: string;
  logoText: string;
  color: string;
  helpLinks: HelpLink[];
  featureFlags: ThemeFlags;
};

export type TenantResolution = {
  ok: boolean;
  error: string | null;
  pathname: "/app";
  theme: TenantTheme | null;
};

function flagLine(theme: TenantTheme) {
  const flags = theme.featureFlags;
  return [
    flags.help ? "help on" : "help off",
    "paper preview on",
    "trading off",
    "orders locked",
    "wallet off",
    "credentials off",
  ].join(" · ");
}

function Mark({ theme }: { theme: TenantTheme }) {
  return (
    <div className="tenant-mark">
      <span className="tenant-swatch" style={{ background: theme.color }} aria-hidden="true" />
      <strong>{theme.logoText}</strong>
      <span className="mono">{theme.color}</span>
    </div>
  );
}

function Links({ theme }: { theme: TenantTheme }) {
  return (
    <p className="tenant-links">
      {theme.helpLinks.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
      ))}
    </p>
  );
}

export function TenantBrand({
  applied,
  previews,
}: {
  applied: TenantResolution;
  previews: TenantResolution[];
}) {
  return (
    <section className="tenant-brand" data-branding>
      <p className="muted tiny">Shell path {applied.pathname}. A theme applies only for an allowlisted host.</p>
      <article className="tenant-card" data-applied data-host-result={applied.ok ? "applied" : "rejected"}>
        <h2>Tenant host</h2>
        {applied.ok && applied.theme ? (
          <>
            <Mark theme={applied.theme} />
            <Links theme={applied.theme} />
            <p>{flagLine(applied.theme)}</p>
          </>
        ) : (
          <p className="notice notice-warn" role="status">{applied.error}</p>
        )}
      </article>
      <div className="tenant-previews">
        {previews.map((preview) => preview.theme ? (
          <article key={preview.theme.tenantId} className="tenant-card" data-preview={preview.theme.tenantId}>
            <p className="eyebrow">Preview · {preview.theme.host}</p>
            <Mark theme={preview.theme} />
            <Links theme={preview.theme} />
            <p>{flagLine(preview.theme)}</p>
          </article>
        ) : null)}
      </div>
    </section>
  );
}
