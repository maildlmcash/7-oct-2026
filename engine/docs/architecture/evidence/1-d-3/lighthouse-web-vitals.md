# Lighthouse and Web Vitals — task 1.D.3

Recorded: 2026-10-07T13:02:44.254Z.
Owner: DLM CASH.
Truth label: PAPER-SIMULATED. The page was the Next dev server, not a production build.

## Measurement

Lighthouse 12.8.2. Chrome was Playwright Chromium 140.0.7339.186. The user flow loaded `/app` and then clicked a navigation button.

| Metric | Value |
| --- | --- |
| LCP | 3116.20595 ms on the load step |
| INP | 61.435 ms on the click timespan |
| CLS | 0 on both steps |
| Earlier load-only sample | 2802.274 ms at 2026-10-07T12:36:33.785Z, no INP in that report |
| Total blocking time on the load-only run | 16368.5 ms in dev |

Dev-server blocking time is not a production score. The numbers above are the lab values that were printed. They are not rounded into a different score.

## Result

PASS for the closeout rule, which asks for measured numbers. Orders stay locked.
