"use client";

import { useState } from "react";
import {
  OBSERVED_SERIES,
  SYNTHETIC_SURFACES,
  attachTestEvent,
  displayOwner,
  fieldText,
  readinessView,
  type ReadinessView,
  type SeriesCell,
} from "@crypto-prediction-engine/contracts/telemetry";

const SERIES_LABELS: Record<(typeof OBSERVED_SERIES)[number], string> = {
  p50: "p50",
  p95: "p95",
  p99: "p99",
  freshness: "freshness",
  disconnects: "disconnects",
  rateLimitHeadroom: "rate-limit headroom",
};

function measuredText(measured: SeriesCell["measured"]) {
  if (measured.present) return `${measured.value} · ${measured.evidence}`;
  if (measured.note === "rate limit is not configured") return measured.note;
  return fieldText(measured);
}

function cells(row: {
  target: SeriesCell["target"];
  measured: SeriesCell["measured"];
  limit: SeriesCell["limit"];
  source: string;
  sampleWindow: SeriesCell["sampleWindow"];
  breach: string;
}) {
  return (
    <>
      <td>{fieldText(row.target)}</td>
      <td>{measuredText(row.measured)}</td>
      <td>{fieldText(row.limit)}</td>
      <td>{row.source}</td>
      <td>{fieldText(row.sampleWindow)}</td>
      <td data-breach={row.breach} className={`breach breach-${row.breach.toLowerCase()}`}>{row.breach}</td>
    </>
  );
}

export function ReadinessMetrics() {
  const [view, setView] = useState<ReadinessView>(() => readinessView());

  return (
    <section className="card readiness" data-readiness>
      <header className="card-head">
        <div>
          <span className="eyebrow">ADMIN · OPERATIONAL READINESS</span>
          <h2>Operational readiness</h2>
        </div>
        <span className="pill pill-warn">{view.truth}</span>
      </header>
      <p className="muted tiny">Each metric shows target, measured value, limit, source, sample window, and breach. Missing telemetry is UNKNOWN. UNKNOWN is not a pass.</p>
      <div className="table-scroll">
        <table>
          <caption>Metric definitions</caption>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Owner</th>
              <th>Target</th>
              <th>Measured</th>
              <th>Limit</th>
              <th>Source</th>
              <th>Sample window</th>
              <th>Breach</th>
            </tr>
          </thead>
          <tbody>
            {view.metrics.map((row) => (
              <tr key={row.family} data-metric={row.family}>
                <td>{row.family}</td>
                <td>{displayOwner(row.owner)}</td>
                {cells(row)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Observed</h3>
      <div className="table-scroll">
        <table>
          <caption>Observed series</caption>
          <thead>
            <tr>
              <th>Series</th>
              <th>Target</th>
              <th>Measured</th>
              <th>Limit</th>
              <th>Source</th>
              <th>Sample window</th>
              <th>Breach</th>
            </tr>
          </thead>
          <tbody>
            {OBSERVED_SERIES.map((name) => (
              <tr key={name} data-series={name}>
                <td>{SERIES_LABELS[name]}</td>
                {cells(view.observed[name])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Security checks</h3>
      <ul className="readiness-list" aria-label="Security checks">
        {view.observed.securityChecks.map((check) => (
          <li key={check.name} data-security={check.name}>
            <b>{check.name}</b>
            <span>{fieldText(check.target)}</span>
            <span>{fieldText(check.measured)}</span>
            <span>{check.source}</span>
            <span data-breach={check.breach} className={`breach breach-${check.breach.toLowerCase()}`}>{check.breach}</span>
          </li>
        ))}
      </ul>
      <h3>Synthetic checks</h3>
      <div className="readiness-surfaces">
        {SYNTHETIC_SURFACES.map((surface) => (
          <div key={surface} role="group" aria-label={`${surface} synthetic checks`}>
            <h4>{surface}</h4>
            <ul className="readiness-list">
              {view.synthetic.filter((row) => row.surface === surface).map((row) => (
                <li key={`${row.surface}-${row.check}`} data-synthetic={`${row.surface}:${row.check}`}>
                  <b>{row.check}</b>
                  <span className={`breach breach-${row.result.toLowerCase()}`}>{row.result}</span>
                  <span>{row.evidence ?? "not measured"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button type="button" className="button button-dark" onClick={() => setView(attachTestEvent(view))}>Attach test event</button>
      <p className="muted tiny">A test event records measured percentiles and a layout failure. It does not set a product target, and it does not mark a pass.</p>
    </section>
  );
}
