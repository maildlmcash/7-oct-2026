"use client";

import { useEffect, useState } from "react";
import { DEX_VENUES } from "../../../services/dex-plan.mjs";

type Pool = { id: string; name: string; liquidity: number; score: number; liquidityPoints: number; activityPoints: number; weight: number; use: string; priceChangeH24?: number | null; priceFlag?: string };
type Row = { field: string; value: string; meaning: string };
type Plan = {
  ok: boolean;
  error?: string;
  name?: string;
  conditions?: string[];
  uses?: string[];
  scorePlan?: string[];
  note?: string;
  pools?: Pool[];
  selected?: { id: string; name: string; liquidityPoints: number; activityPoints: number; score: number; weight: number; use: string };
  rows?: Row[];
  cex?: { ok: boolean; error?: string; asset?: string; symbol?: string; dexPrice?: number; cexMid?: number; gapPct?: number; flag?: string } | null;
};

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadPools(name: string, pools: Pool[]) {
  const header = ["dex", "pool", "pool_id", "liquidity_usd", "prediction_score", "liquidity_points", "activity_points", "weight", "prediction_use", "price_change_h24", "price_flag"];
  const lines = [
    header.join(","),
    ...pools.map((pool) => [name, pool.name, pool.id, pool.liquidity, pool.score, pool.liquidityPoints, pool.activityPoints, pool.weight, pool.use, pool.priceChangeH24 ?? "", pool.priceFlag ?? ""].map(csvCell).join(",")),
  ];
  const file = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = `${name.toLowerCase().replaceAll(" ", "-")}-prediction-scores.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function DexPlan() {
  const [chain, setChain] = useState<"ethereum" | "arbitrum" | "order-book" | "hybrid" | "index">("ethereum");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [poolId, setPoolId] = useState("");
  const [withCex, setWithCex] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const venue = DEX_VENUES.find((item) => item.id === venueId) ?? null;

  useEffect(() => {
    if (!venueId) return;
    let stopped = false;
    const params = new URLSearchParams({ venue: venueId });
    if (poolId) params.set("pool", poolId);
    if (withCex) params.set("cex", "1");
    void fetch(`/api/dex/plan?${params}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: Plan) => { if (!stopped) setPlan(body); })
      .catch(() => { if (!stopped) setPlan({ ok: false, error: "This DEX API is not connected." }); });
    return () => { stopped = true; };
  }, [venueId, poolId, withCex]);

  return (
    <div className="cex-pick">
      <article className="card">
        <p className="muted tiny">One chain and one DEX at a time. No swap is sent.</p>
        <div className="cex-books" role="group" aria-label="DEX chain">
          <button type="button" className="button button-accent" aria-pressed={chain === "ethereum"} onClick={() => { setChain("ethereum"); setVenueId(null); setPoolId(""); setPlan(null); setWithCex(false); }}>Ethereum</button>
          <button type="button" className="button button-dark" aria-pressed={chain === "arbitrum"} onClick={() => { setChain("arbitrum"); setVenueId(null); setPoolId(""); setPlan(null); setWithCex(false); }}>Arbitrum</button>
          <button type="button" className="button button-dark" aria-pressed={chain === "order-book"} onClick={() => { setChain("order-book"); setVenueId(null); setPoolId(""); setPlan(null); setWithCex(false); }}>Order Book DEX</button>
          <button type="button" className="button button-dark" aria-pressed={chain === "hybrid"} onClick={() => { setChain("hybrid"); setVenueId(null); setPoolId(""); setPlan(null); setWithCex(false); }}>Hybrid DeFi</button>
          <button type="button" className="button button-dark" aria-pressed={chain === "index"} onClick={() => { setChain("index"); setVenueId(null); setPoolId(""); setPlan(null); setWithCex(false); }}>DexScreener</button>
        </div>
        <div className="cex-venue-list">
          {DEX_VENUES.filter((item) => item.chain === chain).map((item) => (
            <button key={item.id} type="button" aria-pressed={item.id === venueId} onClick={() => { setVenueId(item.id); setPoolId(""); setPlan(null); setWithCex(false); }}>
              <b>{item.rank}. {item.name}</b>
              <small>{item.id === venueId && plan?.selected ? `Prediction score ${plan.selected.score}` : item.chain}</small>
            </button>
          ))}
        </div>
      </article>
      {!venue ? <article className="card"><h3>Select one DEX</h3><p className="muted">No pool is open. Mixed DEX data stays hidden until you click a name.</p></article> : (
        <article className="card">
          <header className="card-head">
            <div>
              <span className="eyebrow">{venue.chain.toUpperCase()} · {venue.name.toUpperCase()} ONLY</span>
              <h3>{venue.name}</h3>
            </div>
            <span className={plan?.ok ? "pill pill-live" : "pill pill-warn"}>{plan == null ? "CONNECTING" : plan.ok ? "LIVE" : "ERROR"}</span>
          </header>
          {plan && !plan.ok ? <p className="notice notice-error">{plan.error}</p> : null}
          {plan?.note ? <p className="notice notice-info">{plan.note}</p> : null}
          {plan?.ok ? (
            <>
              <ul className="cex-limits">{plan.conditions?.map((line) => <li key={line}>{line}</li>)}</ul>
              <h4>Used on this website</h4>
              <ul className="cex-limits">{plan.uses?.map((line) => <li key={line}>{line}</li>)}</ul>
              <h4>Prediction score</h4>
              <ul className="cex-limits">{plan.scorePlan?.map((line) => <li key={line}>{line}</li>)}</ul>
              <h4>Pools</h4>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Pool</th><th>Prediction score</th><th>Weight</th><th>24h change</th><th>Flag</th><th>Liquidity points</th><th>Activity points</th></tr></thead>
                  <tbody>
                    {plan.pools?.map((pool) => (
                      <tr key={pool.id}>
                        <td><button type="button" aria-pressed={pool.id === (poolId || plan.selected?.id)} onClick={() => setPoolId(pool.id)}>{pool.name}</button></td>
                        <td><b>{pool.score}</b></td>
                        <td>{pool.weight}</td>
                        <td>{pool.priceChangeH24 == null ? "—" : `${pool.priceChangeH24}%`}</td>
                        <td>{pool.priceFlag ?? "—"}</td>
                        <td>{pool.liquidityPoints}</td>
                        <td>{pool.activityPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="alert-form">
                <button type="button" className={withCex ? "button button-accent" : "button button-dark"} aria-pressed={withCex} onClick={() => setWithCex((value) => !value)}>With CEX</button>
                <button type="button" className="button button-dark" onClick={() => plan.pools && downloadPools(`${venue.chain} ${venue.name}`, plan.pools)}>Download CSV</button>
              </div>
              <div className="stat-line"><span>Score</span><b>{plan.selected?.score} · weight {plan.selected?.weight}</b></div>
              <div className="stat-line"><span>Points</span><b>{plan.selected?.liquidityPoints} liquidity + {plan.selected?.activityPoints} activity</b></div>
              <p className="muted tiny">{plan.selected?.use}</p>
              {withCex && plan.cex ? (
                plan.cex.ok ? (
                  <p className="notice notice-warn">{plan.cex.asset} DEX {plan.cex.dexPrice} versus {plan.cex.symbol} mid {plan.cex.cexMid?.toFixed(2)}. Gap {plan.cex.gapPct?.toFixed(2)}%. {plan.cex.flag}</p>
                ) : <p className="notice notice-error">{plan.cex.error}</p>
              ) : null}
              <h4>Every field from this call</h4>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Field</th><th>Value now</th><th>What it is</th></tr></thead>
                  <tbody>{plan.rows?.map((row) => <tr key={row.field}><td className="mono">{row.field}</td><td className="mono">{row.value}</td><td>{row.meaning}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : null}
        </article>
      )}
    </div>
  );
}
