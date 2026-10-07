"use client";

import { useState } from "react";
import {
  MODEL_HEALTH_VIEWS,
  MODEL_HEALTH_LAYOUT,
  readModelHealthChart,
} from "../../../services/model-health-charts.mjs";

type HealthBin = {
  low: string;
  high: string;
  count: number;
  status: string;
  observedRate: string | null;
};

type HealthPoint = {
  eventTime?: number | string;
  brier?: string | null;
  logLoss?: string | null;
  value?: string | null;
};

type HealthRecord = {
  name?: string;
  age?: string;
  status?: string;
  from?: number | string;
  to?: number | string;
  reason?: string;
};

type HealthChart = {
  ok: boolean;
  view: string;
  status: string;
  note: string | null;
  formula: string | null;
  sampleSize: number | null;
  observedWindow: { from: number | string; to: number | string } | null;
  bins: HealthBin[];
  points: HealthPoint[];
  records: HealthRecord[];
  modelVersion: string | null;
  dataVersion: string | null;
  featureVersion: string | null;
  direction: null;
  guaranteesDirection: boolean;
};

function cell(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function loadChart(view: string, bound: number) {
  if (view === "brier/log-loss" || view === "drift") return readModelHealthChart({ view, bound });
  return readModelHealthChart({ view });
}

export function ModelHealthCharts({ bound }: { bound: number }) {
  const [view, setView] = useState<string | null>(null);
  const layout = MODEL_HEALTH_LAYOUT;
  const loaded = (view ? loadChart(view, bound) : null) as HealthChart | null;

  return (
    <div
      className="layout-charts"
      data-loaded={loaded ? "true" : "false"}
      data-columns={layout.columns}
      data-stack={layout.stack}
      data-view={loaded ? loaded.view : undefined}
      data-guarantees-direction={loaded ? "false" : undefined}
    >
      <div className="layout-chart-controls" role="group" aria-label="Model health series">
        {MODEL_HEALTH_VIEWS.map((name) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {name}
          </button>
        ))}
      </div>
      {loaded ? (
        <div className="layout-chart">
          <p>{loaded.sampleSize == null ? "Sample size is not configured" : `Sample size ${loaded.sampleSize}`}</p>
          <p>
            {loaded.observedWindow
              ? `Observed window ${loaded.observedWindow.from} to ${loaded.observedWindow.to}`
              : "observed window is not set"}
          </p>
          {loaded.status === "insufficient" ? <p>insufficient</p> : null}
          {loaded.formula ? <p>{loaded.formula}</p> : null}
          {loaded.note ? <p>{loaded.note}</p> : null}
          {loaded.modelVersion ? <p>{`Model version ${loaded.modelVersion}`}</p> : null}
          {loaded.dataVersion ? <p>{`Data version ${loaded.dataVersion}`}</p> : null}
          {loaded.featureVersion ? <p>{`Feature version ${loaded.featureVersion}`}</p> : null}
          <p>This chart does not guarantee a direction.</p>
          {loaded.bins.length > 0 ? (
            <table>
              <caption>predicted probability buckets vs observed outcome</caption>
              <thead>
                <tr>
                  <th scope="col">low</th>
                  <th scope="col">high</th>
                  <th scope="col">count</th>
                  <th scope="col">status</th>
                  <th scope="col">observed rate</th>
                </tr>
              </thead>
              <tbody>
                {loaded.bins.map((bin) => (
                  <tr key={`${bin.low}-${bin.high}`}>
                    <td>{bin.low}</td>
                    <td>{bin.high}</td>
                    <td>{bin.count}</td>
                    <td>{bin.status === "insufficient" ? "insufficient" : ""}</td>
                    <td>{cell(bin.observedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {loaded.points.length > 0 ? (
            <table>
              <caption>source value</caption>
              <thead>
                <tr>
                  <th scope="col">event time</th>
                  <th scope="col">value</th>
                </tr>
              </thead>
              <tbody>
                {loaded.points.map((point, index) => (
                  <tr key={`${cell(point.eventTime)}-${index}`}>
                    <td>{cell(point.eventTime)}</td>
                    <td>{cell(point.brier ?? point.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {loaded.records.length > 0 ? (
            <table>
              <caption>model health records</caption>
              <thead>
                <tr>
                  <th scope="col">record</th>
                  <th scope="col">status</th>
                </tr>
              </thead>
              <tbody>
                {loaded.records.map((record, index) => (
                  <tr key={`${cell(record.name ?? record.reason)}-${index}`}>
                    <td>{cell(record.name ?? record.reason)}</td>
                    <td>{cell(record.status ?? record.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
