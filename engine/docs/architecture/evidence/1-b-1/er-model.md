# Identity ER model (task 1.B.1)

```mermaid
erDiagram
  tenant ||--o{ tenant : "parent_id"
  tenant ||--o{ identity_principal : "tenant_id"
  identity_principal ||--o{ identity_role_assignment : "principal_id + tenant_id"
  identity_principal ||--o{ identity_role_assignment : "parent_principal_id + tenant_id"
  role_definition ||--o{ identity_role_assignment : "role_name"
  identity_principal ||--o{ identity_capability_rule : "principal_id + tenant_id"
  identity_capability ||--o{ identity_capability_rule : "capability_name"
  tenant {
    bigint id
    bigint parent_id
    text status
  }
  identity_principal {
    bigint id
    bigint tenant_id
    text subject_key
    text status
  }
  identity_role_assignment {
    bigint id
    bigint tenant_id
    bigint principal_id
    text role_name
    bigint parent_principal_id
    text status
  }
  identity_capability {
    text name
  }
  identity_capability_rule {
    bigint tenant_id
    bigint principal_id
    text capability_name
    text effect
  }
  role_definition {
    text name
    boolean is_default
  }
```

Parent and child assignments share one `tenant_id`. The foreign key rejects a parent principal from another tenant.

Combined accounts hold Retailer and Customer on one principal. The merge unions only capabilities inside those roles' ceilings. The shipped ceilings are empty. An explicit deny removes a capability from that union.
