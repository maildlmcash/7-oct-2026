# Target map compared with this repository (task 1.A.1)

The phase manual's codebase map is a target. It is not a description of this tree. This file records the mismatch and the remediation decision. No source directory was renamed.

| Target path | Present here | Remediation for later tasks |
| --- | --- | --- |
| `apps/control-web/` | No. Product UI is `engine/apps/web/` (Next.js). The git root also has a TanStack shell in `src/` that renders that shell. | Keep `engine/apps/web` until a later ADR moves it. Do not create a second SPA in this task. |
| `services/control-api/` | No directory. Checklist, session, policy, and desk logic are `engine/services/*.mjs` plus `engine/apps/web/app/api/`. | Map control-api work onto those modules. Do not add an empty service folder as a placeholder. |
| `services/market-gateway/` | No directory. Public venue adapters are `engine/services/*-public.mjs` and git-root `src/routes/api/*`. | Phase 1 does not add exchange or chain connections. Leave adapters where they are. |
| `services/scoring/` | No directory. Model and feature modules already exist as individual files under `engine/services/`. | Do not claim a scoring service is running. |
| `services/paper-engine/` | No directory. Paper order, fill, and ledger modules are `engine/services/paper-*.mjs` and futures paper modules. | Paper mode stays the standing rule. No new order path. |
| `packages/contracts/` | Yes, at `engine/packages/contracts/`. | Use this package. |
| `packages/ui/` | No. Shared UI is `engine/packages/ui-kit/`. | Later UI tasks edit `ui-kit` or record a new ADR before adding `packages/ui`. |
| `data/migrations/` | Yes, at `engine/data/migrations/` (27 files). Git root `migrations/auth/` is a separate auth schema. | Product migrations stay under `engine/data/migrations`. |
| `infra/` | Not present. | Deployment files are not invented here. |
| `docs/adr/` | Was absent. Decision log already exists at `engine/docs/decisions/` (`0001`–`0083`). | This task adds `engine/docs/adr/0001-baseline.md` and does not move `docs/decisions`. |

## Decision

Later phase-1 prompts name paths such as `apps/control-web/src/shell/`. Those paths are not created by 1.A.1. The next task must read this map and edit the existing shell (`engine/apps/web/app/shell.tsx` and `engine/packages/ui-kit`) unless its own ADR chooses a different boundary.

Package manifests were read and not edited. The root lockfile is already inconsistent, and rewriting it would change the baseline this record measured.
