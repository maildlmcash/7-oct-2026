# 0064 — Paper order lifecycle

Status: accepted for paper-only append-only order events. Duplicate requests replay the stored event. No live venue client is opened.

## Context

TASK 14.A.01 asks for paper-only order states for create, acknowledge, partial fill, fill, cancel, reject, timeout, and reconcile, with idempotency keys and append-only order events.

Design page 2 names paper trading, order reconciliation, and idempotency before auto trading. It does not draw the transition edges, a fill quantity, a timeout duration, or a balance formula. Decision 0048 walks a book and does not record an order. Decision 0060 leaves `orderSubmitted` false. The public Binance modules are market-data clients and are not order routes.

`LIVE_TRADING` and `LIVE_ORDERS_LOCKED` are not read from the environment. The frozen health pair stays `OFF` and `true`.

## Decision

`services/paper-orders.mjs` exports `createPaperOrderStore`, `appendPaperOrder`, `readPaperOrder`, `PAPER_ORDER_STATES`, `PAPER_ORDER_MODE`, `PAPER_ORDER_PRODUCT`, and `PAPER_ORDER_LIMITATIONS`. The product is `spot`. Any other product is `product is not supported` and is not stored. The mode is `paper`. `venueClient` stays null. `liveOrderSubmitted` stays false.

The only first event is `create`. `acknowledge`, `cancel`, `reject`, `timeout`, and `reconcile` can follow `create`. `partial fill`, `fill`, `cancel`, `timeout`, and `reconcile` can follow `acknowledge`. `partial fill` can repeat, and `fill`, `cancel`, `timeout`, and `reconcile` can follow it. `fill`, `cancel`, `reject`, and `timeout` can be followed only by `reconcile`. Nothing follows `reconcile`. Any other step is `transition is not allowed` and appends nothing. The source does not draw this edge list. These edges are the closed set that makes each named state reachable.

Each accepted request appends one frozen event. Older events are not rewritten. The same idempotency key and the same actor, order, product, and state return the stored event with `idempotentReplay` true. A different body is `idempotency key is already recorded`. A second `create` for an existing order is `order is already recorded`. The actor is a same-tenant Admin. Any other role is `role scope denied`.

Fill quantity, timeout duration, and balance reconciliation stay `NOT IN SOURCE`. No PostgreSQL table was added. The module imports no venue client and does not place a live order.

## Evidence

`pnpm test:paper-orders` passed 3/3, duration_ms 145.997497. Order `fixture-order` appends `create`, `acknowledge`, two `partial fill` events, `fill`, and `reconcile`. The first event array stays length 1 after the later appends. Replaying `fixture-key-create` returns the original create event and leaves six events stored. `fixture-reject`, `fixture-timeout`, and `fixture-cancel` reach `reject`, `timeout`, and `cancel`, then `reconcile`. A fill before `acknowledge` is `transition is not allowed`. A `reject` after `acknowledge` and a `cancel` after `fill` append nothing. The same key with state `acknowledge` is `idempotency key is already recorded`. Product `futures` is not stored and `fixture-futures-order` is not echoed. A Customer is `role scope denied`. Evidence text `bearer fixture-token` is not echoed. State `live-order` is `unsupported field` and is not echoed. A cross-tenant read is `order is not configured`. Every returned order has `venueClient` null, `liveTrading` `OFF`, and `liveOrdersLocked` true. The module source has no import. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Order ids and idempotency keys are fixtures and are NOT IN SOURCE. Decision 0065 records the paper decision gate and does not change these events.
