# Secret reference threat model

Task 1.D.2. Truth label: MOCK. This note describes the paper-only reference workflow. It does not connect a KMS or a secret manager.

## Assets

- Secret material. This deployment does not store it.
- Reference metadata: id, tenant, purpose, manager path, scope, rotation, and revocation.
- Audit rows: actor, action, target, decision, and reason.

## Actors

- Desk Admin can open the screen and can revoke reference metadata.
- Every other role is `role scope denied` for write, rotate, and revoke.
- A caller who submits material is treated as untrusted input. The bytes are dropped.

## Threats and controls

| Threat | Control |
| --- | --- |
| The UI echoes submitted material | The form is cleared. The status sentence does not include the submitted bytes. The table shows `masked`. |
| A read API returns material | `retrieveMaterial` returns `secret material is not retrievable` and a null material field. |
| Logs or telemetry keep material | Audit and telemetry rows use the five audit fields only. Material keys are not copied. |
| A write path stores credentials | Paper mode keeps secret write not enabled. No material column is written. |
| Withdrawal or trade scope is granted | Withdrawal is `BLOCKED`. Trade is `UNAVAILABLE`. |
| Rotation prints a new secret | Rotation is not enabled and returns no material. |
| Revocation deletes a live credential | Revocation changes metadata only. There is no stored credential to destroy. |
| KMS is treated as connected | The KMS key slot stays `not configured`. |

## Residual

No secret-manager client is installed. A later phase that enables write must keep material write-only and out of logs, telemetry, and screenshots. This paper deployment does not enable that path.

`LIVE_TRADING` stays `OFF`. `LIVE_ORDERS_LOCKED` stays `true`. Catalog grants stay empty.
