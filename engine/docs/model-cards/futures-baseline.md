# Futures signed baseline

Status: paper-mode interpretable score. The raw score is a signed total. It is not a probability and it is not an order. This card does not enable futures paper execution.

## Intended use

This card describes the versioned futures baseline in `services/futures-baseline.mjs`. The approved score is the design page 8 signed linear score:

100 * (0.18*PriceTrend + 0.18*OIPriceImpulse + 0.16*TakerFlow + 0.14*FundingCrowding + 0.12*BasisSignal + 0.12*LiquidationFlow + 0.10*CrossVenueConfirmation)

Each input is an already signed component on the closed interval from -1 to +1. The score clips each component, multiplies it by the published integer weight, and clamps the total to the closed interval from -100 to +100. A missing component stays missing. The caller supplies the sign of FundingCrowding. This card does not choose contrarian or momentum.

The raw score is that clamped total. calibratedProbability stays null. The horizon is a caller-supplied name plus a positive duration. Spot horizons are not the futures horizons. The label is the contract-family mark return. The walk-forward net adds the execution-cost net return, caller funding, and caller liquidation.

Live trading stays OFF. The score does not place an order.

## Limitations

The futures horizon duration is NOT IN SOURCE. Logistic, gradient-boosted, isotonic, and Platt parameters are NOT IN SOURCE. Brier, log loss, drawdown, and uncertainty stay NOT IN SOURCE. The linear and inverse mark-return denominators are the contract-family reading of the decision 0052 payoff, and the source does not write that algebra.

Funding and liquidation in the net are caller-supplied signed returns. The funding interval is not converted. Risk caps and the liquidation distance stay in the futures risk diagnostic. Feed faults stay in the futures fault check. Neither is applied inside this score.

A futures paper execution remains blocked until the review gate has a model card, a risk review, an evaluation report, a rollback record, and two distinct approvers. This card does not clear that gate. Live trading stays OFF and live orders stay locked.
