# Threat-model review — task 1.D.3

Recorded: 2026-10-07T13:02:44.254Z.
Owner: DLM CASH.
Truth label: PAPER-SIMULATED.

## Auth

Reviewed. Shipped role ceilings are empty. `authorizeControlRequest` was called for Super Admin, Admin, Super Distributor, Distributor, Retailer, Customer, and Retailer+Customer on desk, tenant-alpha, tenant-beta, and tenant-gamma. All 140 decisions were denied. Trade, wallet, live-order, and withdrawal were denied. The signed-out shell lists every section because it has no identity session. The role navigation test requires those buttons, and a forged navigation call returns login denied. That listing is not a grant. It does not block phase 2.

## Tenant boundary

Reviewed. Only the request Host header is trusted. A spoofed forwarded host is rejected. localhost is an unknown host. Preview themes are signed. The private key is not stored. It does not block phase 2.

## Admin edits

Reviewed. Checklist writes require a desk Admin and CSRF. Secret write is not enabled. The release gate does not deploy. It does not block phase 2.

## Checklists

Reviewed. Project checklist statuses stay TODO, IN_PROGRESS, PASS, FAIL, and BLOCKED. This closeout does not mark the admin baseline checklist complete. It does not block phase 2.

## Subdomain resolution

Reviewed. Subdomain resolution is the white-label host check. Query host is ignored. Feature flags cannot turn on live trading, orders, wallet access, or exchange credentials. Fetches with Host alpha.preview.test, beta.preview.test, and gamma.preview.test returned 200, applied a theme, and kept LIVE ORDERS LOCKED. It does not block phase 2.
