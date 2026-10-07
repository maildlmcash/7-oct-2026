"use client";

import { useMemo, useState } from "react";
import {
  CAPABILITY_LABELS,
  DETAIL_TABS,
  PROVIDER_LISTS,
  connectionStatus,
  editProviderMetadata,
  filterProviders,
  screenRegistry,
  sortProviders,
  type ProviderRecord,
} from "@crypto-prediction-engine/contracts/providers";

const COLUMNS = [
  ["status", "Status"],
  ["product", "Product"],
  ["version", "Version"],
  ["lastVerified", "Last verified"],
  ["sourceUrl", "Source URL"],
] as const;

function tabText(record: ProviderRecord, tab: (typeof DETAIL_TABS)[number]) {
  const detail = record.tabs[tab] as {
    family?: string;
    version?: string;
    endpoints?: string[];
    host?: string | null;
    streams?: string[];
    state?: string;
    fields?: string[];
    calculations?: string[];
  } | string[] | undefined;
  if (tab === "permissions") {
    return CAPABILITY_LABELS.map((label) => `${label}: ${record.capabilities[label]}`).join("\n");
  }
  if (Array.isArray(detail)) return detail.join("\n");
  if (!detail) return "NOT_CONFIGURED";
  if (tab === "REST") {
    const endpoints = detail.endpoints?.length ? detail.endpoints.join("\n") : "NOT_CONFIGURED";
    return `Family: ${detail.family ?? "none"}\nVersion: ${detail.version ?? "none"}\n${endpoints}`;
  }
  if (tab === "WebSocket") {
    const streams = detail.streams?.length ? detail.streams.join("\n") : "NOT_CONFIGURED";
    return `Host: ${detail.host ?? "NOT_CONFIGURED"}\nVersion: ${detail.version ?? "none"}\n${streams}`;
  }
  if (tab === "chain/RPC") return detail.state ?? "NOT_CONFIGURED";
  if (tab === "fields") return detail.fields?.length ? detail.fields.join("\n") : "NOT_CONFIGURED";
  if (tab === "calculations") return detail.calculations?.join("\n") ?? "none configured";
  return "NOT_CONFIGURED";
}

export function ProviderRegistry({ canEdit = false }: { canEdit?: boolean }) {
  const [rows, setRows] = useState<ProviderRecord[]>(() => screenRegistry().map((record) => ({ ...record })));
  const [list, setList] = useState<(typeof PROVIDER_LISTS)[number]>("CEX");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<(typeof COLUMNS)[number][0]>("product");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedId, setSelectedId] = useState("cex-binance-spot");
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>("REST");
  const [draft, setDraft] = useState({ product: "Binance Spot", version: "2026-09-18", sourceUrl: "https://data-api.binance.vision/" });
  const [message, setMessage] = useState("");

  const visible = useMemo(
    () => sortProviders(filterProviders(rows.filter((record) => record.list === list), query), sortKey, sortDir),
    [rows, list, query, sortKey, sortDir],
  );
  const selected = rows.find((record) => record.id === selectedId && record.list === list) ?? null;

  function choose(record: ProviderRecord) {
    setSelectedId(record.id);
    setDraft({
      product: record.product,
      version: record.version,
      sourceUrl: record.sourceUrl ?? "",
    });
    setMessage("");
  }

  function sortBy(key: (typeof COLUMNS)[number][0]) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function save() {
    if (!selected || !canEdit) {
      setMessage("role scope denied");
      return;
    }
    const result = editProviderMetadata(selected, {
      product: draft.product,
      version: draft.version,
      sourceUrl: draft.sourceUrl,
    }, { role: "Admin", tenantId: selected.tenantId });
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setRows((current) => current.map((record) => (record.id === selected.id ? result.record : record)));
    setMessage(`${result.status}. Last verified remains empty.`);
  }

  return (
    <section className="provider-registry" data-registry="true" aria-label="Provider registry">
      <div className="section-intro">
        <div>
          <span className="eyebrow">ADMIN · PROVIDER REGISTER</span>
          <h2>Provider registry</h2>
          <p>Metadata only. A source URL is not a connection test. Last verified stays empty in this phase.</p>
        </div>
      </div>
      <div className="provider-lists" role="group" aria-label="Provider lists">
        {PROVIDER_LISTS.map((name) => (
          <button key={name} type="button" aria-pressed={list === name} onClick={() => { setList(name); setMessage(""); }}>
            {name}
          </button>
        ))}
      </div>
      <label className="provider-filter">
        Filter providers
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="table-scroll">
        <table>
          <caption>{list}</caption>
          <thead>
            <tr>
              {COLUMNS.map(([key, label]) => (
                <th key={key} aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => sortBy(key)}>{label}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => (
              <tr key={record.id} data-status={connectionStatus(record)}>
                <td>{connectionStatus(record)}</td>
                <td><button type="button" onClick={() => choose(record)}>{record.product}</button></td>
                <td>{record.version}</td>
                <td>{record.lastVerified ?? "not verified"}</td>
                <td>{record.sourceUrl ?? "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <article className="card provider-detail">
          <h3>{selected.product}</h3>
          <p data-connection={connectionStatus(selected)}>{connectionStatus(selected)}. Last verified: not verified.</p>
          <ul aria-label="Capability labels">
            {CAPABILITY_LABELS.map((label) => (
              <li key={label} data-capability={label}>{label}: {selected.capabilities[label]}</li>
            ))}
          </ul>
          <div className="provider-tabs" role="tablist" aria-label="Provider detail">
            {DETAIL_TABS.map((name) => (
              <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                {name}
              </button>
            ))}
          </div>
          <pre role="tabpanel">{tabText(selected, tab)}</pre>
          {canEdit ? (
            <form onSubmit={(event) => { event.preventDefault(); save(); }}>
              <label>Product<input value={draft.product} onChange={(event) => setDraft({ ...draft, product: event.target.value })} /></label>
              <label>Version<input value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></label>
              <label>Source URL<input value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></label>
              <button type="submit">Save metadata</button>
            </form>
          ) : <p>role scope denied</p>}
          {message ? <p role="status">{message}</p> : null}
        </article>
      ) : null}
    </section>
  );
}
