"use client";

import { useEffect, useState } from "react";

type HistoryRow = { version: number; status: string; recordedAt: string };
type CheckRow = {
  templateId: string;
  title: string;
  version: number;
  owner: string | null;
  dueOn: string | null;
  evidenceUrl: string | null;
  status: string;
  dependsOn: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  recordedAt: string | null;
  history: HistoryRow[];
};
type IssueRow = {
  correlationId: string;
  section: string | null;
  route: string | null;
  httpStatus: number;
  recordedAt: string;
  status: string;
};
type ChecklistBody = { ok: boolean; error?: string; checks?: CheckRow[]; issues?: IssueRow[] };

const STATUSES = ["TODO", "IN_PROGRESS", "PASS", "FAIL", "BLOCKED"];

function emptyDraft(check: CheckRow) {
  return {
    templateId: check.templateId,
    owner: check.owner ?? "",
    dueOn: check.dueOn ?? "",
    evidenceUrl: check.evidenceUrl ?? "",
    status: check.status,
    dependsOn: check.dependsOn ?? "",
    reviewer: check.reviewer ?? "",
    reviewedAt: check.reviewedAt ?? "",
  };
}

export function ProjectChecklist({ canEdit = false, csrfToken = null }: { canEdit?: boolean; csrfToken?: string | null }) {
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [selectedId, setSelectedId] = useState("web");
  const [draft, setDraft] = useState({
    templateId: "web",
    owner: "",
    dueOn: "",
    evidenceUrl: "",
    status: "TODO",
    dependsOn: "",
    reviewer: "",
    reviewedAt: "",
  });
  const [message, setMessage] = useState("");

  function apply(body: ChecklistBody) {
    if (!body.checks) return;
    setChecks(body.checks);
    setIssues(body.issues ?? []);
  }

  useEffect(() => {
    let cancel = false;
    fetch("/api/project-checklist", { cache: "no-store", credentials: "include" })
      .then((response) => response.json())
      .then((body: ChecklistBody) => {
        if (cancel || !body.ok) return;
        apply(body);
        const selected = body.checks?.find((check) => check.templateId === "web") ?? body.checks?.[0];
        if (selected) setDraft(emptyDraft(selected));
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const selected = checks.find((check) => check.templateId === selectedId) ?? null;

  function choose(check: CheckRow) {
    setSelectedId(check.templateId);
    setDraft(emptyDraft(check));
    setMessage("");
  }

  async function save() {
    if (!canEdit) {
      setMessage("role scope denied");
      return;
    }
    const response = await fetch("/api/project-checklist", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken ?? "",
      },
      body: JSON.stringify(draft),
    });
    const body: ChecklistBody = await response.json();
    if (!body.ok) {
      setMessage(body.error ?? "invalid checklist");
      return;
    }
    apply(body);
    const next = body.checks?.find((check) => check.templateId === draft.templateId);
    if (next) setDraft(emptyDraft(next));
    setMessage(`${draft.status}. Version ${next?.version ?? ""}.`);
  }

  return (
    <section className="project-checklist" data-checklist="true" aria-label="Project checklist">
      <div className="section-intro">
        <div>
          <span className="eyebrow">PROJECT CHECKLIST</span>
          <h2>Project checklist</h2>
          <p>Each save keeps a new version. PASS needs an evidence link, a reviewer, and a review timestamp. A BLOCKED dependency locks the downstream task.</p>
        </div>
      </div>
      <div className="project-lists" role="group" aria-label="Checklist templates">
        {checks.map((check) => (
          <button key={check.templateId} type="button" aria-pressed={selectedId === check.templateId} onClick={() => choose(check)}>
            {check.title}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <caption>Project checks</caption>
          <thead>
            <tr>
              <th>Template</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Due date</th>
              <th>Evidence link</th>
              <th>Dependency</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.templateId} data-template={check.templateId} data-status={check.status}>
                <td><button type="button" onClick={() => choose(check)}>{check.title}</button></td>
                <td>{check.status}</td>
                <td>{check.owner ?? "none"}</td>
                <td>{check.dueOn ?? "none"}</td>
                <td>{check.evidenceUrl ?? "none"}</td>
                <td>{check.dependsOn ?? "none"}</td>
                <td>{check.version > 0 ? String(check.version) : "not saved"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <article className="card">
          <h3>{selected.title}</h3>
          <p data-version={selected.version}>{selected.status}. {selected.version > 0 ? `Version ${selected.version}.` : "Not saved."}</p>
          <ul aria-label="Version history">
            {selected.history.length === 0 ? <li>No saved version</li> : selected.history.map((item) => (
              <li key={item.version}>Version {item.version} · {item.status}</li>
            ))}
          </ul>
          {canEdit ? (
            <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>Owner<input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} /></label>
              <label>Due date<input value={draft.dueOn} onChange={(event) => setDraft({ ...draft, dueOn: event.target.value })} /></label>
              <label>Evidence link<input value={draft.evidenceUrl} onChange={(event) => setDraft({ ...draft, evidenceUrl: event.target.value })} /></label>
              <label>Status
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                  {STATUSES.map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
              <label>Dependency
                <select value={draft.dependsOn} onChange={(event) => setDraft({ ...draft, dependsOn: event.target.value })}>
                  <option value="">none</option>
                  {checks.filter((check) => check.templateId !== selected.templateId).map((check) => (
                    <option key={check.templateId} value={check.templateId}>{check.title}</option>
                  ))}
                </select>
              </label>
              <label>Reviewer<input value={draft.reviewer} onChange={(event) => setDraft({ ...draft, reviewer: event.target.value })} /></label>
              <label>Reviewed at<input value={draft.reviewedAt} onChange={(event) => setDraft({ ...draft, reviewedAt: event.target.value })} /></label>
              <button type="submit">Save check</button>
            </form>
          ) : <p>role scope denied</p>}
          {message ? <p role="status">{message}</p> : null}
        </article>
      ) : null}
      <article className="card">
        <h3>Monitored issues</h3>
        {issues.length === 0 ? <p>No monitored issue is open.</p> : (
          <ul aria-label="Monitored issues">
            {issues.map((issue) => (
              <li key={issue.correlationId} data-issue={issue.correlationId}>
                {issue.status} · HTTP {issue.httpStatus} · {issue.section ?? "section not named"} · {issue.route ?? "route not named"}
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
