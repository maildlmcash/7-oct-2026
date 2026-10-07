import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { health } from "../apps/web/health.mjs";
import { simulatePaperFill } from "../services/paper-fills.mjs";
import {
  PAPER_LEDGER_ASSUMPTIONS,
  PAPER_LEDGER_KINDS,
  PAPER_LEDGER_LIMITATIONS,
  appendPaperLedger,
  createPaperLedgerStore,
  reconcilePaperLedger,
  recoverPaperLedger,
} from "../services/paper-ledger.mjs";
import * as ledger from "../services/paper-ledger.mjs";
import { appendPaperOrder, createPaperOrderStore } from "../services/paper-orders.mjs";
import { createSpotBookSync } from "../services/spot-book-sync.mjs";

// Fee rate 0.001 is a caller fixture. The source names no fee tier and no rounding scale.
// Bids and asks are the decision 0034 book.
const TIME = 1672515782136;
const ACTOR = { id: "fixture-admin", role: "Admin", tenantId: "fixture-tenant" };

function depth(U, u, bids, asks) {
  return { e: "depthUpdate", E: TIME, s: "BNBBTC", U, u, b: bids, a: asks };
}

function openedBook() {
  const sync = createSpotBookSync("BNBBTC");
  const event = depth(157, 160, [
    ["0.0024", "1"],
    ["0.0025", "3"],
  ], [
    ["0.0027", "1"],
    ["0.0026", "3"],
  ]);
  assert.equal(sync.noteConnected(0).healthy, false);
  assert.equal(sync.ingestDepth(event, event.E).book, null);
  const opened = sync.ingestSnapshot({
    lastUpdateId: event.U,
    bids: [["0.0024", "1"]],
    asks: [["0.0026", "1"]],
  });
  assert.equal(opened.healthy, true);
  return opened;
}

function stores() {
  return { orders: createPaperOrderStore(), ledger: createPaperLedgerStore() };
}

function lifecycle(orders, orderId, states) {
  for (const state of states) {
    const result = appendPaperOrder(orders, {
      actor: { ...ACTOR },
      orderId,
      idempotencyKey: `${orderId}-${state}`,
      state,
      product: "spot",
    });
    assert.equal(result.ok, true, result.error);
  }
}

function levelsOf(fill) {
  return fill.levels.map((level) => ({ price: level.price, quantity: level.quantity }));
}

function addFill(book, orderId, side, key) {
  const result = appendPaperLedger(book.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: key,
    kind: "fill",
    orderId,
    side,
    levels: levelsOf(book.fills[side]),
    feeRate: book.fills[side].feeRate,
    fee: book.fills[side].fee,
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.row.liveOrderSubmitted, false);
  return result;
}

function roundTrip() {
  const opened = openedBook();
  const bought = simulatePaperFill({
    status: opened,
    levels: 10,
    side: "buy",
    quantity: "4",
    feeRate: "0.001",
    latency: "0",
  });
  const sold = simulatePaperFill({
    status: opened,
    levels: 10,
    side: "sell",
    quantity: "4",
    feeRate: "0.001",
    latency: "0",
  });
  assert.equal(bought.ok, true, bought.error);
  assert.equal(sold.ok, true, sold.error);
  assert.equal(bought.notional, "0.0105");
  assert.equal(bought.fee, "0.0000105");
  assert.equal(sold.notional, "0.0099");
  assert.equal(sold.fee, "0.0000099");
  const book = stores();
  book.fills = { buy: bought, sell: sold };
  lifecycle(book.orders, "fixture-buy", ["create", "acknowledge", "fill"]);
  lifecycle(book.orders, "fixture-sell", ["create", "acknowledge", "fill"]);
  return book;
}

function state(position, cash, realizedPnl) {
  return { position, cash, realizedPnl };
}

function paper(result) {
  assert.equal(result.liveTrading, "OFF");
  assert.equal(result.liveOrdersLocked, true);
  assert.equal(result.liveOrderSubmitted, false);
  assert.equal(result.venueClient, null);
  assert.equal(result.mode, "paper");
  assert.equal(result.product, "spot");
  assert.deepEqual(result.assumptions, [...PAPER_LEDGER_ASSUMPTIONS]);
  assert.deepEqual(result.limitations, [...PAPER_LEDGER_LIMITATIONS]);
}

test("a closed paper round trip balances exactly", () => {
  const book = roundTrip();
  const bought = addFill(book, "fixture-buy", "buy", "fixture-key-buy");
  const replayed = addFill(book, "fixture-buy", "buy", "fixture-key-buy");
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(replayed.row, bought.row);
  const checkpoint = appendPaperLedger(book.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-position",
    kind: "position",
    quantity: "4",
  });
  assert.equal(checkpoint.ok, true, checkpoint.error);
  addFill(book, "fixture-sell", "sell", "fixture-key-sell");
  const balanced = reconcilePaperLedger(book, {
    actor: { ...ACTOR },
    stated: state("0", "-0.0006204", "-0.0006204"),
  });
  paper(balanced);
  assert.equal(balanced.ok, true, balanced.error);
  assert.equal(balanced.promoted, true);
  assert.equal(balanced.alert, false);
  assert.deepEqual(balanced.discrepancies, []);
  assert.equal(balanced.position, "0");
  assert.equal(balanced.cash, "-0.0006204");
  assert.equal(balanced.realizedPnl, "-0.0006204");
  assert.equal(balanced.fee, "0.0000204");
  assert.equal(balanced.funding, null);
  assert.equal(balanced.fillCount, 2);
  assert.equal(balanced.rowCount, 3);
  assert.equal(book.orders.orders.size, 2);
  assert.equal(book.orders.orders.get("fixture-tenant\u0000fixture-buy").events.length, 3);

  const restarted = stores();
  restarted.orders = book.orders;
  restarted.fills = book.fills;
  addFill(restarted, "fixture-buy", "buy", "fixture-key-buy");
  appendPaperLedger(restarted.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-position",
    kind: "position",
    quantity: "4",
  });
  addFill(restarted, "fixture-sell", "sell", "fixture-key-sell");
  const replay = reconcilePaperLedger(restarted, {
    actor: { ...ACTOR },
    stated: state("0", "-0.0006204", "-0.0006204"),
  });
  assert.equal(replay.promoted, true, replay.error);
  assert.equal(replay.cash, balanced.cash);
  assert.equal(replay.position, balanced.position);
  assert.equal(replay.realizedPnl, balanced.realizedPnl);
  assert.equal(book.ledger.rows.length, 3);

  const funded = stores();
  funded.orders = book.orders;
  funded.fills = book.fills;
  addFill(funded, "fixture-buy", "buy", "fixture-key-buy");
  addFill(funded, "fixture-sell", "sell", "fixture-key-sell");
  const funding = appendPaperLedger(funded.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-funding",
    kind: "funding",
    amount: "-0.0001",
  });
  assert.equal(funding.ok, true, funding.error);
  const deposit = appendPaperLedger(funded.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-cash",
    kind: "cash",
    amount: "1",
  });
  assert.equal(deposit.ok, true, deposit.error);
  const withCash = reconcilePaperLedger(funded, {
    actor: { ...ACTOR },
    stated: state("0", "0.9992796", "-0.0007204"),
  });
  paper(withCash);
  assert.equal(withCash.promoted, true, withCash.error);
  assert.equal(withCash.cash, "0.9992796");
  assert.equal(withCash.realizedPnl, "-0.0007204");
  assert.equal(withCash.funding, "-0.0001");
  assert.equal(Object.isFrozen(withCash), true);
});

test("a discrepancy stays visible and blocks promotion", () => {
  const book = roundTrip();
  addFill(book, "fixture-buy", "buy", "fixture-key-buy");
  addFill(book, "fixture-sell", "sell", "fixture-key-sell");
  const rounded = reconcilePaperLedger(book, {
    actor: { ...ACTOR },
    stated: state("0", "-0.0006", "-0.0006"),
  });
  paper(rounded);
  assert.equal(rounded.ok, false);
  assert.equal(rounded.blocked, "BLOCKED");
  assert.equal(rounded.promoted, false);
  assert.equal(rounded.alert, true);
  assert.equal(rounded.cash, "-0.0006204");
  assert.equal(rounded.realizedPnl, "-0.0006204");
  const cashIssue = rounded.discrepancies.find((item) => item.field === "cash");
  const pnlIssue = rounded.discrepancies.find((item) => item.field === "realizedPnl");
  assert.equal(cashIssue.code, "cash does not match");
  assert.equal(cashIssue.derived, "-0.0006204");
  assert.equal(cashIssue.stated, "-0.0006");
  assert.equal(pnlIssue.code, "realized pnl does not match");
  assert.equal(pnlIssue.derived, "-0.0006204");
  const recovered = recoverPaperLedger(book, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-recover",
    stated: state("0", "-0.0006", "-0.0006"),
  });
  paper(recovered);
  assert.equal(recovered.promoted, false);
  assert.equal(recovered.alert, true);
  assert.equal(recovered.cash, "-0.0006204");
  assert.equal(recovered.rowCount, 3);
  assert.equal(recovered.idempotentReplay, false);
  assert.equal(book.ledger.rows[2].kind, "reconciliation");
  assert.equal(book.ledger.rows[0].fee, "0.0000105");
  const again = recoverPaperLedger(book, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-recover",
    stated: state("0", "-0.0006", "-0.0006"),
  });
  assert.equal(again.idempotentReplay, true);
  assert.equal(again.rowCount, 3);
  assert.equal(again.promoted, false);
  assert.equal(book.orders.orders.get("fixture-tenant\u0000fixture-buy").events.length, 3);

  const open = stores();
  open.orders = book.orders;
  open.fills = book.fills;
  addFill(open, "fixture-buy", "buy", "fixture-key-buy");
  const early = reconcilePaperLedger(open, {
    actor: { ...ACTOR },
    stated: state("4", "-0.0105105", "0"),
  });
  paper(early);
  assert.equal(early.promoted, false);
  assert.equal(early.position, "4");
  assert.equal(early.realizedPnl, null);
  assert.equal(early.discrepancies[0].code, "realized pnl is not closed");
  assert.equal(early.discrepancies[0].derived, null);
  const held = reconcilePaperLedger(open, {
    actor: { ...ACTOR },
    stated: state("4", "-0.0105105", null),
  });
  assert.equal(held.promoted, true, held.error);
  assert.equal(held.fee, "0.0000105");

  const mismatchedFee = stores();
  mismatchedFee.orders = book.orders;
  const wrongFee = appendPaperLedger(mismatchedFee.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-fee",
    kind: "fill",
    orderId: "fixture-buy",
    side: "buy",
    levels: levelsOf(book.fills.buy),
    feeRate: "0.001",
    fee: "0.01",
  });
  assert.equal(wrongFee.ok, true, wrongFee.error);
  const feeReport = reconcilePaperLedger(mismatchedFee, {
    actor: { ...ACTOR },
    stated: state("4", "-0.0105105", null),
  });
  assert.equal(feeReport.promoted, false);
  assert.equal(feeReport.cash, "-0.0105105");
  assert.equal(feeReport.discrepancies[0].code, "fee does not match");
  assert.equal(feeReport.discrepancies[0].derived, "0.0000105");
  assert.equal(feeReport.discrepancies[0].stated, "0.01");
  const kept = recoverPaperLedger(mismatchedFee, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-fee-recover",
    stated: state("4", "-0.0105105", null),
  });
  assert.equal(kept.promoted, false);
  assert.equal(kept.cash, "-0.0105105");
  assert.equal(mismatchedFee.ledger.rows[0].fee, "0.01");

  const pending = stores();
  lifecycle(pending.orders, "fixture-pending", ["create", "acknowledge"]);
  pending.fills = book.fills;
  addFill(pending, "fixture-pending", "buy", "fixture-key-pending");
  const blocked = reconcilePaperLedger(pending, {
    actor: { ...ACTOR },
    stated: state("4", "-0.0105105", null),
  });
  assert.equal(blocked.promoted, false);
  assert.equal(blocked.discrepancies[0].code, "order event does not match");
  assert.equal(blocked.discrepancies[0].orderId, "fixture-pending");
  lifecycle(pending.orders, "fixture-pending", ["fill"]);
  const restored = reconcilePaperLedger(pending, {
    actor: { ...ACTOR },
    stated: state("4", "-0.0105105", null),
  });
  assert.equal(restored.promoted, true, restored.error);
  assert.equal(pending.ledger.rows.length, 1);
  assert.equal(pending.orders.orders.get("fixture-tenant\u0000fixture-pending").events.at(-1).state, "fill");
});

test("the paper ledger does not submit a live order", () => {
  assert.deepEqual(PAPER_LEDGER_KINDS, [
    "cash",
    "position",
    "fill",
    "fee",
    "funding",
    "reconciliation",
  ]);
  assert.deepEqual(Object.keys(ledger).sort(), [
    "PAPER_LEDGER_ASSUMPTIONS",
    "PAPER_LEDGER_KINDS",
    "PAPER_LEDGER_LIMITATIONS",
    "appendPaperLedger",
    "createPaperLedgerStore",
    "reconcilePaperLedger",
    "recoverPaperLedger",
  ]);
  const book = stores();
  const denied = appendPaperLedger(book.ledger, {
    actor: { id: "fixture-customer", role: "Customer", tenantId: "fixture-tenant" },
    idempotencyKey: "fixture-key",
    kind: "cash",
    amount: "1",
  });
  paper(denied);
  assert.equal(denied.error, "role scope denied");
  assert.equal(book.ledger.rows.length, 0);
  const empty = reconcilePaperLedger(book, {
    actor: { ...ACTOR },
    stated: state("0", "0", null),
  });
  assert.equal(empty.error, "ledger is not configured");
  assert.equal(empty.promoted, false);
  const secret = reconcilePaperLedger(book, {
    actor: { ...ACTOR },
    stated: state("bearer fixture-token", "0", null),
  });
  paper(secret);
  assert.equal(secret.error, "secret value is not allowed");
  assert.equal(JSON.stringify(secret).includes("fixture-token"), false);
  const rejected = appendPaperLedger(book.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-last",
    kind: "fill",
    orderId: "fixture-buy",
    side: "buy",
    levels: [{ price: "9.001", quantity: "1" }],
    feeRate: "0.001",
    fee: "0",
    lastPrice: "9.001",
  });
  assert.equal(rejected.error, "unsupported field");
  assert.equal(JSON.stringify(rejected).includes("9.001"), false);
  const direct = appendPaperLedger(book.ledger, {
    actor: { ...ACTOR },
    idempotencyKey: "fixture-key-direct",
    kind: "reconciliation",
  });
  assert.equal(direct.error, "unsupported field");
  assert.equal(book.ledger.rows.length, 0);
  const source = readFileSync(new URL("../services/paper-ledger.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("readPaperOrder"), true);
  assert.equal(source.includes("appendPaperOrder"), false);
  assert.equal(source.includes("placeOrder"), false);
  assert.equal(source.includes("binance"), false);
  assert.equal(source.includes("https://"), false);
  assert.equal(source.includes("wss://"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("WebSocket"), false);
  assert.deepEqual(health, { status: "ok", liveTrading: "OFF", liveOrdersLocked: true });
});
