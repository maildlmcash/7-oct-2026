# 1.B.2 authorization matrix

Truth label: MOCK. Fixture principals only. The shipped role ceiling grants nothing.

Denied cases: 32 of 32.

| Route | Case | Decision | Reason | Audited |
| --- | --- | --- | --- | --- |
| GET /api/checklist-owner | privilege escalation | denied | privilege escalation | false |
| GET /api/checklist-owner | cross-tenant | denied | cross-tenant | false |
| GET /api/checklist-owner | revoked role | denied | role revoked | false |
| GET /api/checklist-owner | forged UI | denied | capability denied | false |
| POST /api/checklist-owner | privilege escalation | denied | privilege escalation | true |
| POST /api/checklist-owner | cross-tenant | denied | cross-tenant | true |
| POST /api/checklist-owner | revoked role | denied | role revoked | true |
| POST /api/checklist-owner | forged UI | denied | capability denied | true |
| POST /api/control/policy | privilege escalation | denied | privilege escalation | true |
| POST /api/control/policy | cross-tenant | denied | cross-tenant | true |
| POST /api/control/policy | revoked role | denied | role revoked | true |
| POST /api/control/policy | forged UI | denied | capability denied | true |
| POST /api/control/tenant | privilege escalation | denied | privilege escalation | true |
| POST /api/control/tenant | cross-tenant | denied | cross-tenant | true |
| POST /api/control/tenant | revoked role | denied | role revoked | true |
| POST /api/control/tenant | forged UI | denied | capability denied | true |
| POST /api/control/subtree | privilege escalation | denied | privilege escalation | true |
| POST /api/control/subtree | cross-tenant | denied | cross-tenant | true |
| POST /api/control/subtree | revoked role | denied | role revoked | true |
| POST /api/control/subtree | forged UI | denied | capability denied | true |
| POST /api/control/commission | privilege escalation | denied | privilege escalation | true |
| POST /api/control/commission | cross-tenant | denied | cross-tenant | true |
| POST /api/control/commission | revoked role | denied | role revoked | true |
| POST /api/control/commission | forged UI | denied | capability denied | true |
| GET /api/control/principals | privilege escalation | denied | privilege escalation | true |
| GET /api/control/principals | cross-tenant | denied | cross-tenant | true |
| GET /api/control/principals | revoked role | denied | role revoked | true |
| GET /api/control/principals | forged UI | denied | capability denied | true |
| POST /api/control/connector | privilege escalation | denied | privilege escalation | true |
| POST /api/control/connector | cross-tenant | denied | cross-tenant | true |
| POST /api/control/connector | revoked role | denied | role revoked | true |
| POST /api/control/connector | forged UI | denied | capability denied | true |

