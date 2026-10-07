# 0038 — Permission-aware search indexing

Status: accepted for the in-memory index and query.

## Context

TASK 09.A.02 asks to attach tenant and visibility attributes to each search document and to enforce authorization during indexing and query execution. Cross-tenant and role-scope queries must return no unauthorized documents. Tests must include a stale permission change.

Decision 0037 stored checklist items and incidents only when the tenant id matched `authorizedTenantId`, and it rejected a tenant id on a symbol, venue, token, prediction, or runbook. That decision left query authorization for this task. The source names no visibility vocabulary such as public, private, or internal. The role catalog in `packages/contracts/src/roles.mjs` names Super Admin, Admin, Super Distributor, Distributor, Retailer, and Customer. `services/checklist-status-view.mjs` already allows a same-tenant Customer or Admin to read and a same-tenant Admin to edit. Other roles are denied. The permission matrix grants nothing, and phase 17 owns grants, so this task does not invent search grants from that empty matrix. Design section 18 names OpenSearch. No OpenSearch process or `services/search-indexer/` directory is in this repository.

## Decision

`services/search-documents.mjs` requires `tenantId` and `visibility` on every kind, including symbol, venue, token, prediction, and runbook. Visibility is a non-empty list of unique existing role names. This supersedes the decision 0037 rule that a tenant id on those five kinds is unauthorized tenant data. A tenant mismatch is now `role scope denied`.

Indexing and `reviseSearchVisibility` require `canEditChecklist`: the actor is an Admin of the document tenant. A Customer, a Super Admin, a distributor role, a retailer, and a cross-tenant Admin store nothing. Unknown actor keys, including a client `granted` flag, fail closed with `role scope denied`. Sensitive fields and raw order-book tick streams are still rejected before authorization and are not stored.

`querySearchDocuments` and `readSearchDocuments` take the same actor. There is no unauthenticated dump. A known role that fails `canReadChecklistStatus` gets an empty document list. A same-tenant Customer or Admin receives a document only when the latest visibility revision includes that role and the tenant matches. Visibility cannot grant a role the existing read rule denies. An unknown role or an unknown query key returns `role scope denied` and no documents.

The index keeps `visibilityById`. A query uses the last revision, not a cached allow and not the visibility copied onto the row at index time. A later revision that removes Customer hides the document from Customer while Admin still receives it. A Customer revision is denied and leaves the current visibility in place. No visibility age or TTL is named, so none is applied. The module does not open OpenSearch, does not add a shell section, and does not place an order. Decision 0039 records measured search metrics and configurable alert thresholds and does not change this authorization.

## Evidence

`pnpm test:search-documents` passed 4/4, duration_ms 393.360384. Seven fixtures still index under schema `search-document` and version `fixture-1`, each with tenant `tenant-a` and visibility Admin and Customer. A password, a private-key block, bids and asks, and a tick stream are rejected and leave the index empty. A tenant-b checklist submitted by a tenant-a Admin is `role scope denied` and is not stored. A Customer index is denied. A cross-tenant query returns an empty list and does not include the symbol. Super Admin, Super Distributor, Distributor, and Retailer queries return an empty list, including a document whose visibility is only Distributor. A query with `granted: true` and a query with an unknown role return `role scope denied` and no documents. After an Admin narrows visibility from Admin and Customer to Admin, the Customer query is empty and the Admin query still returns the document with visibility Admin. A following Customer query stays empty. A Customer revision and a cross-tenant revision do not change that result. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`.
