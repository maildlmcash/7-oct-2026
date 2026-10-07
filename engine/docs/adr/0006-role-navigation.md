# 0006 — Role-aware navigation

Status: accepted for task 1.B.3.
Date: 2026-10-07.
Owner: DLM CASH (GitHub `maildlmcash`).

## Path map

The manual names `apps/control-web/src/navigation/` and `docs/security/role-matrix.md`. This tree has no `apps/control-web/` directory and no `docs/security/` directory. ADR 0002 keeps the shell in `apps/web`. ADR 0001 requires a new ADR before adding a directory.

| Manual path | File edited |
| --- | --- |
| `apps/control-web/src/navigation/` | `apps/web/app/navigation/` |
| `docs/security/role-matrix.md` | `docs/security/role-matrix.md` |

Paths above are relative to `engine/`. The signed-out section buttons in `apps/web/app/shell.tsx` stay in place. Desk User and Admin login is a separate paper desk. It is not one of the six identity roles.

## Decision

1. `navigationFromSession` reads the server session only: `authenticated`, `status`, `roles`, and `denies`. A client role, preview field, password, token, or cookie is not a session.
2. Open screens are existing shell sections named by the role baseline. DEX, Wallets, Predictions, Search, and Bugs are not granted. Wallets stay closed. Catalog grant lists stay empty.
3. A must-not action from the baseline is a disabled control with the text `role scope denied`. Unbuilt may-do actions are omitted. They are not shown as enabled.
4. Retailer and Customer together use the union of those two screen lists. An explicit screen deny removes that screen and shows it disabled. Any other pair is `role revoked`. `Retailer+Customer` is not a role name.
5. A server session whose only role is Super Admin may preview another role's screens. The preview model keeps `impersonation` false and keeps the signed-in role as Super Admin. `decideNavigationAction` does not read a preview field. Previewing Customer does not open Customer screens through the API.
6. `POST /api/navigation/action` has no production identity session. A direct call is `login denied`. A test may pass a server fixture session into the same function. That fixture is MOCK. The route does not treat the desk cookie as an identity role.

## Non-claims

- No secret, order, or wallet value is stored.
- No LIVE market status is added.
- `authorizeShell` and `authorizeRequest` are unchanged.
- Commission rates are not calculated.

## Evidence

- `tests/role-navigation.mjs`
- `apps/web/tests/role-nav.spec.ts`
- `docs/architecture/evidence/1-b-3/`
