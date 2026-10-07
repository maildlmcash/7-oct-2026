# Source audit and run status

Audit date: 2026-10-07. Audited the supplied project ZIP after extraction. Statuses below refer to the source tree and the tests actually run, not a deployed environment.

## Defects found in the supplied source

- The default page showed empty checklist status and layout demo content. The Market table consisted of literal `layout fixture` rows.
- The route shell had navigation but no live market UI. Existing service modules had parsers and validators, with no connector wired into the page.
- DEX event and whale eligibility modules had no live source adapter or API route. There were no stored or verified whale identities.
- Root package scripts did not provide `dev`, `build`, `start`, or one deterministic test command.
- `pnpm typecheck` failed on chart layout types. The components called validator functions and treated their result unions as layout objects.
- The old `docs/dependency-map.md` described an empty project and contradicted the actual source/tests.

## Changes made

- Replaced the market fixture with a responsive single-route application UI.
- Wired Binance Spot public `trade` and `bookTicker` combined streams, and the current USDⓈ-M Futures `markPrice@1s` public stream. The UI exposes connection/freshness state and reconnect behavior.
- Added a bounded server-side DexScreener pair-search route with input bounds, timeout, response shaping, and no-store behavior.
- Added fixed-host Blockscout lookup for Ethereum/Base normal transactions. Addresses are manually entered; the device-local list is capped at 15. No automatic whale labels or inferred buy/sell classification are made.
- Added a prediction block state when key source families and calibration evidence are missing, plus a preview-only paper panel. No live order code was added.
- Added run/build/test scripts and split deterministic tests from tests that require PostgreSQL or outbound network.
- Fixed chart layout types by reading the exported layout constants.

## Explicitly not implemented

- 14 further CEX adapters; 15 DEX WebSocket/on-chain swap adapters; independent source consensus.
- A verified, activity-qualified 15-wallet whale list. No source addresses were supplied and no identities were fabricated.
- DEX transaction decoding, pool event stream subscriptions, and wallet/token-transfer event history.
- A trained/calibrated predictive model connected to current features; the UI correctly withholds a score.
- Durable admin settings, technology monitoring, persisted checklist evidence, database-backed paper ledger, simulated fill engine, Android/iOS clients, or role/commission production flows.
- Any live spot or futures order placement. It remains locked.

## Verification record

| Check | Result | Meaning |
| --- | --- | --- |
| Frozen pnpm install | PASS | Workspace lockfile resolved successfully in the audit environment |
| TypeScript / Next route typecheck | PASS after fix | Source compiles against installed dependencies |
| Offline deterministic tests | PASS · 83/83 | PostgreSQL migrations and explicit outbound-network smoke are excluded from this command |
| Playwright browser suite | PASS · 15/15 | Includes mobile/tablet/desktop layout, same-URL navigation, diagnostics, DEX/wallet UI with mocked source responses, and prediction chart behavior |
| Next production build | PASS | Next.js 16.3.8 optimized build completed and emitted the web/API routes |
| Live Binance connectivity | Environment blocked | The browser's public WebSocket TLS check returned `ERR_CERT_AUTHORITY_INVALID` in this audit runner. The app displays per-feed reconnect/stale status; actual live messages must be confirmed on the deployment network. REST smoke is opt-in via `pnpm test:network` |
| PostgreSQL migrations | Not claimed | Requires a local PostgreSQL service and configured test database |
| Browser visual regression | PASS · 15/15 | Playwright Chromium was installed for this check. Actual upstream market values were not used as a test fixture. |

## Run

From repository root: `corepack pnpm install --frozen-lockfile`, `corepack pnpm dev`; open `http://localhost:3000`.

To verify: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`.
