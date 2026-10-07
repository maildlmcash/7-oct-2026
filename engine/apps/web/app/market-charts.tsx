"use client";

import { useState } from "react";
import {
  MARKET_VISUALIZATION_VIEWS,
  MARKET_VISUALIZATION_LAYOUT,
  readMarketVisualization,
} from "../../../services/market-visualizations.mjs";

type ChartPoint = {
  eventTime?: number | string;
  price?: string;
  volume?: string;
  value?: string;
  quantity?: string;
  funding?: string | null;
  openInterest?: string | null;
  basis?: string | null;
  amount?: string;
};

type ChartResult = {
  ok: boolean;
  error: string | null;
  view: string;
  unit: string | null;
  formula: string | null;
  note: string | null;
  points: ChartPoint[];
  direction: null;
  guaranteesDirection: boolean;
};

function cell(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function ChartPoints({ view, points }: { view: string; points: ChartPoint[] }) {
  if (view === "price/volume") {
    return (
      <table>
        <caption>price and volume</caption>
        <thead>
          <tr>
            <th scope="col">event time</th>
            <th scope="col">price</th>
            <th scope="col">volume</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={`${cell(point.eventTime)}-${index}`}>
              <td>{cell(point.eventTime)}</td>
              <td>{cell(point.price)}</td>
              <td>{cell(point.volume)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (view === "depth heatmap") {
    return (
      <table>
        <caption>price and quantity</caption>
        <thead>
          <tr>
            <th scope="col">event time</th>
            <th scope="col">price</th>
            <th scope="col">quantity</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={`${cell(point.eventTime)}-${index}`}>
              <td>{cell(point.eventTime)}</td>
              <td>{cell(point.price)}</td>
              <td>{cell(point.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (view === "funding/OI/basis") {
    return (
      <table>
        <caption>source value</caption>
        <thead>
          <tr>
            <th scope="col">event time</th>
            <th scope="col">funding</th>
            <th scope="col">open interest</th>
            <th scope="col">basis</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={`${cell(point.eventTime)}-${index}`}>
              <td>{cell(point.eventTime)}</td>
              <td>{cell(point.funding)}</td>
              <td>{cell(point.openInterest)}</td>
              <td>{cell(point.basis)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (view === "DEX liquidity") {
    return (
      <table>
        <caption>raw amount</caption>
        <thead>
          <tr>
            <th scope="col">event time</th>
            <th scope="col">amount</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={`${cell(point.eventTime)}-${index}`}>
              <td>{cell(point.eventTime)}</td>
              <td>{cell(point.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const caption = view === "spread" ? "price difference" : view === "CVD" ? "taker buy minus taker sell" : "source value";
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">event time</th>
          <th scope="col">value</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point, index) => (
          <tr key={`${cell(point.eventTime)}-${index}`}>
            <td>{cell(point.eventTime)}</td>
            <td>{cell(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MarketCharts({ bound }: { bound: number }) {
  const [view, setView] = useState<string | null>(null);
  const layout = MARKET_VISUALIZATION_LAYOUT;
  const loaded = (view ? readMarketVisualization({ view, bound }) : null) as ChartResult | null;

  return (
    <div
      className="layout-charts"
      data-loaded={loaded ? "true" : "false"}
      data-columns={layout.columns}
      data-stack={layout.stack}
      data-view={loaded ? loaded.view : undefined}
      data-guarantees-direction={loaded ? "false" : undefined}
    >
      <div className="layout-chart-controls" role="group" aria-label="Chart series">
        {MARKET_VISUALIZATION_VIEWS.map((name) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {name}
          </button>
        ))}
      </div>
      {loaded ? (
        <div className="layout-chart">
          {loaded.unit ? <p>{`Unit ${loaded.unit}`}</p> : null}
          {loaded.formula ? <p>{loaded.formula}</p> : null}
          {loaded.note ? <p>{loaded.note}</p> : null}
          <p>This chart does not guarantee a direction.</p>
          {loaded.points.length > 0 ? (
            <ChartPoints view={loaded.view} points={loaded.points} />
          ) : (
            <p>No plotted points</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
