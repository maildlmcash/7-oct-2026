"use client";

export function SocketDetails({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <div className="table-scroll">
      <h4>WebSocket connection details</h4>
      <table>
        <thead><tr><th>Detail</th><th>Value</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}><td>{row.label}</td><td className="mono">{row.value}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
