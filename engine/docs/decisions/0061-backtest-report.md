# 0061 — Backtest performance report

Status: accepted for every supplied window. The report includes a supplied benchmark and the supplied execution cost. Drawdown, turnover, exposure, win/loss, and uncertainty stay NOT IN SOURCE. No order is placed.

## Context

TASK 13.B.02 asks to report net return, drawdown, turnover, exposure, calibration, win/loss distribution, regime, sample size, and uncertainty, without selecting only favorable windows.

Decision 0048 and decision 0054 name drawdown and uncertainty as NOT IN SOURCE. Decision 0060 prices one fill and does not choose a window.

## Decision

`services/backtest-report.mjs` exports `reportBacktestPerformance` and `checksumBacktestReport`. The caller supplies a manifest and every window. The manifest names the dataset, the model version, the feature version, and the SHA-256 checksum of that manifest plus the windows. A missing manifest, a checksum that is not 64 hex characters, or a checksum that does not match publishes no figures.

Each window keeps its name, net return, supplied benchmark, supplied cost return, and regime. The report keeps that order, including a negative net. The net return is the sum of the window nets. The benchmark is the sum of the supplied benchmark nets, using the existing phrase `supplied net-of-cost benchmark`. The benchmark difference is the evaluated net minus that benchmark. Cost sensitivity is the sum of the supplied execution-cost returns, using the existing execution-cost phrase. A cost shock is `NOT IN SOURCE`. An empty list is `sample is not configured`. A missing benchmark is `benchmark is not configured`. A missing cost is `cost sensitivity is not configured`. A field that asks to keep only favorable windows is `unsupported field` and is not echoed.

Drawdown and uncertainty use the existing `NOT IN SOURCE` phrases. Turnover, exposure, and win/loss are `NOT IN SOURCE`. Calibration keeps the existing calibration phrase and a null value, because these windows do not carry a predicted probability. Sample size is the window count. Every figure cites the same dataset, model version, feature version, and checksum. The module does not drop a negative window and does not place an order.

## Evidence

`pnpm test:backtest-report` passed 3/3, duration_ms 275.063267. Windows `-517/8500` in regime `fixture-loss` and `1` in regime `fixture-gain` both remain. Each benchmark is `0`, so the benchmark total is `0` and the difference equals the summed net `7983/8500`. The cost returns `-517/8500` and `0` sum to `-517/8500`. Sample size is `2`. Every figure cites dataset `fixture-dataset`, model `fixture-model`, feature version `fixture-features`, and the matching checksum. A second call returns the same report. A missing manifest, a favorable-only field, a missing cost, and a checksum that does not match each return null figures. `pnpm health` returned `{"status":"ok","liveTrading":"OFF","liveOrdersLocked":true}`. Regime names and the zero benchmarks are fixtures and are NOT IN SOURCE. Decision 0062 records experiment manifests and does not change this report.
