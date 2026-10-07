/** Closed view fields. Order placement is not part of this contract. */
export const TRADER_INPUT_VIEW_KEYS: readonly [
  "venue",
  "symbol",
  "product",
  "bbo",
  "eventAge",
  "quality",
  "sequenceWatermark",
];

/** Best bid and ask. Decimal strings. Last-trade price is not a BBO. */
export type TraderBbo = {
  readonly bidPrice: string;
  readonly bidQty: string;
  readonly askPrice: string;
  readonly askQty: string;
};

/** Accepted quality. The source names no separate healthy vocabulary word. */
export type TraderQuality = {
  readonly healthy: true;
  readonly reason: null;
};

/**
 * eventAge is a non-negative safe integer.
 * The source names no maximum event age.
 * sequenceWatermark is the accepted sequence, kept as a safe integer or a digit string.
 */
export type TraderInputView = {
  readonly venue: string;
  readonly symbol: string;
  readonly product: string;
  readonly bbo: TraderBbo;
  readonly eventAge: number;
  readonly quality: TraderQuality;
  readonly sequenceWatermark: number | string;
};

export type TraderInputResult =
  | { ok: true; blocked: null; view: TraderInputView }
  | { ok: false; blocked: "BLOCKED"; error: string };

export function readTraderInput(input: unknown): TraderInputResult;
