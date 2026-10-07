// Search load-fixture metrics for TASK 09.C.01.
// Design section 18 names p50, p95, and p99. It names no numeric SLO.
// Targets are the caller-supplied thresholds. They are not universal guarantees.
// The source names no latency unit, freshness unit, or percentile ranking rule.
// Percentiles use nearest rank: ceil(p * n / 100), then the value at that rank.
// An alert fires only when a measured value is greater than a configured threshold.
// Queue lag and freshness are load-fixture integers because no search queue is installed.
// Index size is the caller-supplied in-memory document count. This module does not open OpenSearch.

const SAMPLE_KEYS = Object.freeze(["latency", "error"]);
const OBSERVE_KEYS = Object.freeze(["freshness", "queueLag", "indexSize"]);
const REPORT_KEYS = Object.freeze(["thresholds"]);
const THRESHOLD_KEYS = Object.freeze([
  "p50",
  "p95",
  "p99",
  "errorRate",
  "freshness",
  "queueLag",
  "indexSize",
  "rejectedDocuments",
]);
const RATE_KEYS = Object.freeze(["numerator", "denominator"]);
const PERCENTILES = Object.freeze([
  ["p50", 50],
  ["p95", 95],
  ["p99", 99],
]);

function fail(error) {
  return { ok: false, blocked: "BLOCKED", error };
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return true;
  }
  return false;
}

function whole(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function fraction(numerator, denominator) {
  const g = gcd(BigInt(numerator), BigInt(denominator));
  return `${(BigInt(numerator) / g).toString()}/${(BigInt(denominator) / g).toString()}`;
}

function greater(leftNumerator, leftDenominator, rightNumerator, rightDenominator) {
  return BigInt(leftNumerator) * BigInt(rightDenominator) > BigInt(rightNumerator) * BigInt(leftDenominator);
}

function percentile(sorted, percent) {
  const product = BigInt(percent) * BigInt(sorted.length);
  const rank = Number((product + 99n) / 100n);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function copyRate(value) {
  return Object.freeze({ numerator: value.numerator, denominator: value.denominator });
}

function rateReady(value) {
  return plainObject(value)
    && !unknownKey(value, RATE_KEYS)
    && whole(value.numerator)
    && whole(value.denominator)
    && value.denominator >= 1;
}

export function createSearchMetrics() {
  const samples = [];
  const gauges = { freshness: null, queueLag: null, indexSize: null };
  let rejectedDocuments = 0;

  return {
    recordQuery(sample) {
      if (!plainObject(sample) || unknownKey(sample, SAMPLE_KEYS)) return fail("unsupported field");
      if (!whole(sample.latency) || typeof sample.error !== "boolean") return fail("unsupported field");
      samples.push({ latency: sample.latency, error: sample.error });
      return { ok: true, blocked: null, samples: samples.length };
    },
    recordRejection() {
      if (arguments.length !== 0) return fail("unsupported field");
      rejectedDocuments += 1;
      return { ok: true, blocked: null, rejectedDocuments };
    },
    observe(input) {
      if (!plainObject(input) || unknownKey(input, OBSERVE_KEYS)) return fail("unsupported field");
      for (const key of OBSERVE_KEYS) {
        if (!whole(input[key])) return fail("unsupported field");
      }
      gauges.freshness = input.freshness;
      gauges.queueLag = input.queueLag;
      gauges.indexSize = input.indexSize;
      return { ok: true, blocked: null };
    },
    report(input) {
      const source = input === undefined ? {} : input;
      if (!plainObject(source) || unknownKey(source, REPORT_KEYS)) return fail("unsupported field");
      const thresholds = source.thresholds === undefined ? {} : source.thresholds;
      if (!plainObject(thresholds) || unknownKey(thresholds, THRESHOLD_KEYS)) return fail("unsupported field");
      for (const key of THRESHOLD_KEYS) {
        if (!Object.hasOwn(thresholds, key)) continue;
        if (key === "errorRate") {
          if (!rateReady(thresholds.errorRate)) return fail("unsupported field");
        } else if (!whole(thresholds[key])) return fail("unsupported field");
      }
      if (samples.length === 0) return fail("load fixture is required");
      for (const key of OBSERVE_KEYS) {
        if (gauges[key] === null) return fail(`${key} is not measured`);
      }
      const sorted = samples.map((sample) => sample.latency).sort((left, right) => left - right);
      const errors = samples.reduce((count, sample) => count + (sample.error ? 1 : 0), 0);
      const measured = {
        samples: samples.length,
        errors,
        errorRate: fraction(errors, samples.length),
        freshness: gauges.freshness,
        queueLag: gauges.queueLag,
        indexSize: gauges.indexSize,
        rejectedDocuments,
      };
      for (const [name, percent] of PERCENTILES) measured[name] = percentile(sorted, percent);
      const targets = {};
      const alerts = [];
      for (const key of THRESHOLD_KEYS) {
        if (!Object.hasOwn(thresholds, key)) {
          targets[key] = Object.freeze({ configured: false, value: null });
          continue;
        }
        const value = key === "errorRate" ? copyRate(thresholds.errorRate) : thresholds[key];
        targets[key] = Object.freeze({ configured: true, value });
        if (key === "errorRate") {
          if (greater(errors, samples.length, value.numerator, value.denominator)) {
            alerts.push(Object.freeze({
              metric: key,
              measured: measured.errorRate,
              threshold: fraction(value.numerator, value.denominator),
            }));
          }
        } else if (measured[key] > value) {
          alerts.push(Object.freeze({ metric: key, measured: measured[key], threshold: value }));
        }
      }
      return Object.freeze({
        ok: true,
        blocked: null,
        error: null,
        universalGuarantees: false,
        measured: Object.freeze(measured),
        targets: Object.freeze(targets),
        alerts: Object.freeze(alerts),
      });
    },
  };
}
