"use client";

import { useState } from "react";
import {
  KEY_PERMISSION_CHECKS,
  PERMISSION_SCOPES,
  describeSecretPath,
  listReferences,
  revokeReference,
  submitSecretMaterial,
  type ReferenceRecord,
} from "../../../../../services/secrets/secret-reference.mjs";

const path = describeSecretPath();

export function SecretReferences({ canEdit = false }: { canEdit?: boolean }) {
  const [rows, setRows] = useState<ReferenceRecord[]>(() => listReferences());
  const [message, setMessage] = useState("Secret write is not enabled");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const selected = String(new FormData(form).get("referenceId") ?? "");
    const result = submitSecretMaterial({
      actor: canEdit ? { role: "Admin", tenantId: "desk" } : { role: "Customer", tenantId: "desk" },
      referenceId: selected,
      material: String(new FormData(form).get("material") ?? ""),
    });
    form.reset();
    setMessage(result.error ?? "Secret write is not enabled");
    setRows(listReferences());
  }

  function revoke(id: string) {
    const result = revokeReference({
      actor: canEdit ? { role: "Admin", tenantId: "desk" } : { role: "Customer", tenantId: "desk" },
      referenceId: id,
    });
    setMessage(result.ok ? "Revoked. Metadata only." : result.error ?? "role scope denied");
    setRows(listReferences());
  }

  return (
    <section className="card secret-references" data-credentials>
      <header className="card-head">
        <div>
          <span className="eyebrow">ADMIN · SECRET REFERENCES</span>
          <h2>Secret references</h2>
        </div>
        <span className="pill pill-warn">PAPER</span>
      </header>
      <p className="muted tiny">Metadata and permission scope only. Secret material is masked, not retrievable, and excluded from logs and telemetry.</p>
      <div className="table-scroll">
        <table>
          <caption>Reference metadata</caption>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Purpose</th>
              <th>Manager</th>
              <th>KMS</th>
              <th>Material</th>
              <th>Rotation</th>
              <th>Revocation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-reference={row.id}>
                <td>{row.reference}</td>
                <td>{row.purpose}</td>
                <td>{row.manager}</td>
                <td>{row.kmsKey}</td>
                <td>{row.material}</td>
                <td>{row.rotation}</td>
                <td>{row.revocation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Permission scope</h3>
      <ul className="readiness-list" aria-label="Permission scope">
        {PERMISSION_SCOPES.map((item) => (
          <li key={item.scope} data-scope={item.scope}>
            <b>{item.scope}</b>
            <span>{item.state}</span>
          </li>
        ))}
      </ul>
      <h3>Key permission checklist</h3>
      <ul className="readiness-list" aria-label="Key permission checklist">
        {KEY_PERMISSION_CHECKS.map((item) => (
          <li key={item.id}>
            <span>{item.text}</span>
            <b>{item.state}</b>
          </li>
        ))}
      </ul>
      <p className="muted tiny">Path {path.referenceShape}. KMS {path.kmsKey}. Rotation {path.rotation}. Revocation {path.revocation}. Audit {path.audit.join(", ")}.</p>
      <form onSubmit={submit}>
        <label>
          Reference
          <select name="referenceId" defaultValue="paper-market-read">
            {rows.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
          </select>
        </label>
        <label>
          Secret material
          <input name="material" type="password" autoComplete="off" aria-label="Secret material" />
        </label>
        <button type="submit" className="button button-dark">Save secret reference</button>
      </form>
      {canEdit ? (
        <button type="button" className="button" onClick={() => revoke("paper-market-read")}>Revoke market reference</button>
      ) : (
        <p role="status">role scope denied</p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
