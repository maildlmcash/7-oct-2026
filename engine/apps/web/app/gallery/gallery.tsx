"use client";

import { useState } from "react";
import {
  Card,
  ChartFrame,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PaginatedTable,
  RestrictedState,
  StaleState,
  StatusBadge,
  TextField,
  type StatusTone,
} from "@crypto-prediction-engine/ui-kit";
import "@crypto-prediction-engine/ui-kit/layout.css";
import "../styles/tokens.css";

const TONES: readonly StatusTone[] = ["loading", "empty", "stale", "error", "restricted"];

const STATE_COPY: Record<StatusTone, string> = {
  loading: "Loading. No fixture has arrived.",
  empty: "Empty. There are no rows in this fixture.",
  stale: "Stale. The source time is not current.",
  error: "Error. This fixture failed to load.",
  restricted: "Restricted. This view is not available.",
};

export function Gallery() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [note, setNote] = useState("Fixture note");
  const [applied, setApplied] = useState("Not applied");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="ui-gallery" data-theme={theme} data-density={density} data-ui-gallery="1.A.3">
      <header>
        <p className="ui-mark">crypto-prediction-engine</p>
        <h1>Component gallery</h1>
        <p className="ui-lead">
          Shared UI primitives. These states are fixtures. They are not live market data, orders, or wallet balances.
        </p>
        <div className="ui-toolbar">
          <div role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
              Light
            </button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
              Dark
            </button>
          </div>
          <div role="group" aria-label="Density">
            <button type="button" aria-pressed={density === "comfortable"} onClick={() => setDensity("comfortable")}>
              Comfortable
            </button>
            <button type="button" aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>
              Compact
            </button>
          </div>
        </div>
      </header>
      <main>
        <h2>Data states</h2>
        <div className="ui-stack">
          <LoadingState>{STATE_COPY.loading}</LoadingState>
          <EmptyState>{STATE_COPY.empty}</EmptyState>
          <StaleState>{STATE_COPY.stale}</StaleState>
          <ErrorState>{STATE_COPY.error}</ErrorState>
          <RestrictedState>{STATE_COPY.restricted}</RestrictedState>
        </div>

        <h2>Status badges</h2>
        <div className="ui-toolbar">
          {TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone} />
          ))}
        </div>

        <h2>Cards</h2>
        <div className="ui-grid">
          {TONES.map((tone) => (
            <Card key={tone} title={tone[0].toUpperCase() + tone.slice(1)}>
              <StatusBadge tone={tone} />
              <p>{STATE_COPY[tone]}</p>
            </Card>
          ))}
        </div>

        <h2>Table</h2>
        <PaginatedTable
          caption="Fixture rows"
          headers={["State", "Meaning"]}
          pageSize={3}
          rows={TONES.map((tone) => ({ cells: [tone, STATE_COPY[tone]] }))}
        />

        <h2>Form</h2>
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied("Kept on this page");
          }}
        >
          <TextField
            label="Fixture note"
            name="fixtureNote"
            value={note}
            onChange={setNote}
            hint="Kept in this page only. It is not a secret and it is not sent."
          />
          <button type="submit">Apply fixture note</button>
          <p role="status">{applied}</p>
        </form>

        <h2>Chart container</h2>
        <ChartFrame
          title="Chart container"
          tone="empty"
          detail="No series is drawn. This container does not show a price."
        />

        <h2>Dialog</h2>
        <button type="button" onClick={() => setDialogOpen(true)}>
          Open fixture dialog
        </button>
        <Modal title="Fixture dialog" open={dialogOpen} onClose={() => setDialogOpen(false)}>
          <p>This dialog is a fixture. It does not place an order.</p>
        </Modal>
      </main>
    </div>
  );
}
