# Stack versions (task 1.A.1)

Recorded only after the support and license check below. No manifest version was changed.

## Runtime that actually ran

| Tool | Version | Where declared | Support check on 2026-10-07 | License |
| --- | --- | --- | --- | --- |
| Node.js | 22.23.3 | Not pinned in either `package.json` `engines` field. Binary: `/Users/kumar/.local/node/bin/node`. | Node.js release schedule lists 22.x as Maintenance LTS (Jod). Initial release 2024-04-24. Maintenance start 2025-10-21. End-of-life 2027-04-30. Latest 22 line listed as 22.23.3. Still inside security support. Active LTS on that schedule is 24.x. Source: `https://github.com/nodejs/Release` schedule table. | MIT (Node.js project license). |
| npm | 10.9.9 | Bundled with that Node binary. | Used only to attempt `npm ci` and the root scripts. | npm's own license follows the npm CLI (Artistic-2.0). Not upgraded. |
| pnpm | 10.17.1 | `engine/package.json` `packageManager`. | `corepack pnpm install --frozen-lockfile` succeeded. Corepack printed an optional update to 12.9.1. Not applied. | MIT. |
| Corepack | 0.36.0 | Bundled with Node 22.23.3. | Enabled the pinned pnpm. | Node.js distribution. |

## Locked product libraries (engine)

Resolved from `engine/pnpm-lock.yaml` and the installed `package.json` license field under `engine/apps/web/node_modules`.

| Package | Locked version | Manifest range | License in the installed package | Security note |
| --- | --- | --- | --- | --- |
| next | 16.3.8 | `^16.3.8` | MIT | No advisory in this `pnpm audit` result. |
| react | 19.3.0 | `^19.3.0` | MIT | No advisory in this audit. |
| react-dom | 19.3.0 | `^19.3.0` | MIT | No advisory in this audit. |
| typescript | 7.0.2 | `^7.0.2` in `apps/web` | Apache-2.0 | Typecheck still fails. See the baseline inventory. The compiler version is not the defect. |
| @playwright/test | 1.49.1 | `1.49.1` | Not changed | Pulls `playwright` below 1.55.1. `pnpm audit` reports high advisory GHSA-7mvr-c777-76hp (CVE-2025-59288). Patched in playwright `>=1.55.1`. Not upgraded here. |

## Workspace root libraries

Not installed. `npm ci` failed, so root licenses were not read from `node_modules`. Declared ranges in the root `package.json` include React `^19.2.0`, Vite `^8.2.0`, TypeScript `^5.7.0`, and `@tanstack/react-start` `^1.168.60`. Those ranges are not a verified install.

## What was not validated

- A production `npm run build` or `pnpm build` was not run. Root dependencies are not installed, and the engine typecheck already fails.
- `pnpm audit` covered the engine lockfile only (88 dependencies in the audit metadata).
- No secret scan of the working tree was required to read versions. No credential material is recorded here.
