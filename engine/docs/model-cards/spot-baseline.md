# Spot signed baseline

Status: paper-mode interpretable score. The raw score is a signed total. It is not a probability and it is not an order.

## Intended use

This card describes the versioned Spot baseline in `services/baseline-model.mjs`. The approved score is the design page 8 signed linear score:

S_spot = 100 × (0.22·OBI + 0.20·CVD + 0.16·TradeImbalance + 0.14·TrendRegime + 0.12·DEXNetFlow + 0.10·WhaleVerifiedFlow + 0.06·CrossVenueBreadth).

Each input is an already signed component on the directional scale from -1 to +1. Zero is neutral, positive is upward, and negative is downward. The score clips each component to that closed interval, multiplies it by the published integer weight, and clamps the total to the closed interval from -100 to +100. A registered version freezes these weights. The caller cannot supply a replacement weight set, and auto-learning does not change the stored weights.

The raw `score` field is that clamped total. `calibratedProbability` is a separate field and stays null. Live trading stays OFF. The score does not place an order.

## Limitations

The rolling robust z-score window is NOT IN SOURCE. This version does not compute a z-score. It accepts components that are already signed and clips each one to the closed interval from -1 to +1.

Logistic coefficients are NOT IN SOURCE. Gradient-boosted hyperparameters are NOT IN SOURCE. Isotonic and Platt maps, and the walk-forward folds used to compare them, are NOT IN SOURCE. This version does not fit those models. `calibratedProbability` stays null, so the raw score is not reported as P(up).

A null, missing, or blank component stays missing. It does not become zero, and the score stays null.

Fees, spread, and slippage stay in the execution-cost calculation. They are not subtracted inside this score. The whale list is not a feature source. `WhaleVerifiedFlow` must already be a signed component. The futures signed score is not calculated. The version id `fixture-baseline` is a test fixture and is NOT IN SOURCE. This score is not walk-forward validated. Live trading stays OFF and live orders stay locked.
