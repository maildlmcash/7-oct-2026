# 0028 — Canonical market event envelope

Status: accepted for the public market-event envelope.

## Context

TASK 07.B.01 asks for one canonical envelope with event time, receive time, venue, product, symbol, sequence, price and quantity as decimal strings, schema version, and a raw-event reference. Raw public messages stay append-only.

Design section 2 says adapter raw messages are written to an immutable event log with a source timestamp, a receive timestamp, and a sequence number. The same section names a connection ID on that log. This task's envelope list does not include a connection ID, so the envelope does not require one. Decision 0026 and decision 0027 keep Spot and USD-M parsing in their own adapters. The source names no envelope schema version number and no timestamp format.

## Decision

`services/market-event-envelope.mjs` stores each raw public message once and does not replace or delete it. `normalizeMarketEvent` appends a separate frozen envelope. Event time, receive time, and sequence are kept as the supplied safe integer or as the supplied string. Price and quantity stay decimal strings, so a numeric price is rejected and trailing zeros remain. The schema version is the caller-supplied string. The raw-event reference must point at an appended raw message. A failed normalize writes no envelope. Gap detection stays out of this module. Decision 0029 records Spot diff-depth gaps in a separate module.

## Evidence

`pnpm test:market-event-envelope` covers an official Spot trade stream, the official recent-trade decimal strings `4.00000100` and `12.00000000`, a sequence preserved as a digit string, a rejected numeric price, and a missing raw reference that leaves the log unchanged.
