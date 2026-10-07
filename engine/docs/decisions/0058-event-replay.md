# 0058 — Deterministic event replay

Status: accepted for event-time replay of versioned market events. Two runs of one manifest match. No order is placed.

## Context

TASK 13.A.01 asks to replay versioned market events in event-time order with watermarks, sequence validation, and the same feature code used in production. Two runs over the same manifest must produce matching checksums and predictions.

Design page 2 records a source timestamp, a receive timestamp, and a sequence on an immutable event, and it records an input watermark and a calculation version on each feature. Design page 7 says exchange timestamps are UTC. Decision 0042 treats a sequence at or behind the watermark as stale and publishes no feature numbers. Decision 0043 keeps equal event times in input order. Decision 0045 replays one feature snapshot through the production feature calculator. The source names no general sequence-gap size for this manifest. Spot depth gaps and the futures funding gap stay in those modules. The production feature code does not emit the signed Spot or futures score components. Rolling robust z-score parameters remain NOT IN SOURCE.

## Decision

`services/event-replay.mjs` exports `replayEventManifest` and `EVENT_REPLAY_CHECKSUM`. The checksum is SHA-256 of the canonical prediction list. SHA-256 is the algorithm already used for a pinned snapshot. The source names no checksum algorithm.

The manifest names one registered feature version and at least one event. Each event carries a prediction id, schema version, venue, product, symbol, event time, receive time, and sequence, plus the inputs the feature calculator already accepts. Events are ordered by event-time magnitude. Receive time is stored and is not the sort key. Equal event times keep manifest order. The caller's array is not reordered.

Each venue, product, and symbol has its own sequence watermark. The first accepted event on a stream has an empty watermark. Each later event on that stream is passed to `replayFeatures` with the previous accepted sequence. `replayFeatures` calls the production feature calculator and stamps the registered feature version. A sequence at or behind the watermark is stale, the feature numbers stay null, and the watermark stays on the last accepted sequence. A later sequence is accepted, including a sequence that skips a value, because the source names no general gap size. Sequence `0` is a real sequence. A different symbol does not share the watermark.

Each applied event is one prediction. The prediction cites the feature version, the feature-definition checksum, the input watermark, and the sequence watermark. It has no score and no direction. The feature-version store is not written. A second run of the same manifest returns the same checksum and the same predictions. An empty event list, a duplicate prediction id, a missing schema version, or an unknown field fails closed and returns a null checksum and null predictions.

The module does not call the Spot baseline or the futures baseline. It does not place an order and does not add a PostgreSQL table. Decision 0059 records permitted historical datasets and does not change this replay.

## Evidence

`pnpm test:event-replay` passed 3/3, duration_ms 232.742992. A manifest listed with event time `1499865549590` after event time `1499865550590` replays the earlier event first. Its receive time is later than the other event and does not change that order. Both runs, and a reversed copy of the same events, return the same checksum and the same predictions. The first prediction matches a direct `replayFeatures` call: spread `0.0001`, depth imbalance `0`, CVD `1.5`, funding `0.0001`, liquidation `5`, null basis, and null VWAP. Sequence `28457` is the first watermark and sequence `28458` is the next. A repeated sequence `28457` is stale and its spread stays null. Sequence `28459` after `28457` is accepted. Two events at the same event time keep manifest order, so sequence `11` stays ahead of sequence `10` and the second event is stale. `ETHBTC` and `BTCUSDT` both accept sequence `28457`. Sequence `0` is accepted. Digit strings `9007199254740992` and `9007199254740993` sort by magnitude and both stay accepted. A blank schema version is `schema version is required`. Symbol `guessed` and a book field are `unsupported field` and are not echoed. A duplicate prediction id is `prediction version is already recorded`. A missing feature version stores no prediction. The feature-version prediction map stays empty. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Schema `fixture-schema`, venue `fixture-venue`, feature version `fixture-1`, lookback `fixture-lookback`, and source priority `fixture-source` are fixtures and are NOT IN SOURCE.
