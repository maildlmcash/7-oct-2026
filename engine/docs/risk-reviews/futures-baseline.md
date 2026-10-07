# Futures risk review

Status: review record for the futures baseline. This review does not enable futures paper execution and does not place an order.

## Caps

Design page 9 names max leverage, max notional, the maintenance-margin buffer, and the liquidation-distance floor. It names no numbers. The caller supplies every cap. A missing input or a failed cap returns NO_TRADE. The supplied leverage text is not rewritten. The liquidation-distance formula is NOT IN SOURCE.

The source names no margin-mode list. The caller string is recorded and does not change leverage.

## Feed faults

These faults suppress the futures prediction. Spot data is not copied.

- stale mark/index abstains.
- stale funding abstains.
- funding gap abstains.
- open-interest discontinuity abstains only when the caller injects it. The source names no jump size.
- liquidation-feed outage is degraded and still suppresses the score.

An age equal to the caller lag threshold is not stale. An available liquidation feed with an empty event list is not an outage.

## Gate

Futures paper execution stays blocked until a different model approver and a different risk approver have both approved, and until the model card, this risk review, a matching futures evaluation report, and a rollback record are present. Live trading stays OFF.
