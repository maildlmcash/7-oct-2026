# Key permission checklist

Task 1.D.2. Truth label: MOCK. Paper-only deployment. No stored credential.

| Check | State |
| --- | --- |
| Secret material is masked | enforced |
| Secret material is not retrievable | enforced |
| Secret material is excluded from logs | enforced |
| Secret material is excluded from telemetry | enforced |
| Secret write is not enabled | enforced |
| Trade scope is unavailable | UNAVAILABLE |
| Withdrawal permission is blocked | BLOCKED |
| KMS key is not configured | not configured |
| Rotation is not enabled | not enabled |
| Audit keeps actor, action, target, decision, and reason | enforced |

Scopes on every reference:

| Scope | State |
| --- | --- |
| metadata.read | visible |
| trade | UNAVAILABLE |
| withdrawal | BLOCKED |

Manager path shape: `projects/paper/secrets/<name>`. The path is a reference. It is not a secret value. Revocation is metadata only.
