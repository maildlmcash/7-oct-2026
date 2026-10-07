# 0037 — Versioned search documents

Status: accepted for the in-memory search document schema.

## Context

TASK 09.A.01 asks for versioned documents for symbols, venues, tokens, predictions, checklist items, incidents, and runbooks. Credentials, raw order-book tick streams, and unauthorized tenant data are excluded. Schema validation must reject unsupported or sensitive fields, and representative fixtures must index.

Design section 18 names OpenSearch for symbols, venues, docs, and bugs, checklist, or audit. It says not to put every tick or order book in the search index. The design tree names `services/search-indexer/`. That directory is not in this repository, and no OpenSearch process is installed. Design page 15 forbids password, OTP, API secret, private key, seed phrase, and access token in logs and screenshots. Checklist statuses are the existing six: NOT_STARTED, IN_PROGRESS, PASS, FAIL, BLOCKED, and NOT_APPLICABLE. A combined mobile scope is already rejected. Venue kinds are the existing provider kinds. Spot horizons named in the design include 1h, and a zero direction component is neutral. Wrapped SOL uses mint `So11111111111111111111111111111111111111112` and 9 decimals. Permission-aware query authorization is the next task.

## Decision

`services/search-documents.mjs` stores frozen documents in memory under schema `search-document`. The caller supplies the document version. The seven kinds have closed fields. A sensitive key or a private-key block, a seed phrase, or a bearer value is rejected and not stored. Bid, ask, and tick-stream fields are rejected as a raw order book. A checklist item or an incident is stored only when its tenant id equals the caller's authorized tenant id. A tenant id on a symbol, venue, token, prediction, or runbook is unauthorized tenant data. Unknown fields are rejected. PASS checklist items still require an approver and expiry. Confidence on an incident stays null because no confidence scale is named. The module does not open OpenSearch and does not place an order. Decision 0038 attaches a tenant id and a visibility list to every document and authorizes indexing and query.

## Evidence

`pnpm test:search-documents` passed 3/3. Seven fixtures index with schema `search-document` and version `fixture-1`: symbol BTC, venue Binance Spot, wrapped SOL decimals 9, a neutral 1h prediction, a NOT_STARTED checklist item, a FAIL incident, and a rollback runbook. Probability, model version, venue region, and the checklist version are caller fixtures and are NOT IN SOURCE. A password, a private-key block, bids and asks, and a tick stream are rejected and leave the index empty. A checklist item for `tenant-b` submitted by `tenant-a` is unauthorized tenant data and is not stored. An unknown field, a PASS item without an approver, and scope `mobile` are unsupported. `pnpm health` stayed `liveTrading` `OFF` and `liveOrdersLocked` true.
