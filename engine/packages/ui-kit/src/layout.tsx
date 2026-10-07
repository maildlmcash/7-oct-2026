"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function SectionNav({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: readonly { id: string; label: string; pressed: boolean }[];
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="layout-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.pressed}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function Heading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h1 id={id} className="layout-heading">
      {children}
    </h1>
  );
}

export function Panel({ labelledBy, children }: { labelledBy?: string; children: ReactNode }) {
  return (
    <section className="layout-panel" aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="layout-state ui-state ui-state-empty" role="status">
      {children}
    </p>
  );
}

export function LoadingState({ children }: { children: ReactNode }) {
  return (
    <p className="layout-state ui-state ui-state-loading" role="status" aria-busy="true">
      {children}
    </p>
  );
}

export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <p className="layout-state ui-state ui-state-error" role="alert">
      {children}
    </p>
  );
}

export function StaleState({ children }: { children: ReactNode }) {
  return (
    <p className="layout-state ui-state ui-state-stale" role="status">
      {children}
    </p>
  );
}

export function RestrictedState({ children }: { children: ReactNode }) {
  return (
    <p className="layout-state ui-state ui-state-restricted" role="status">
      {children}
    </p>
  );
}

export const STATUS_TONES = ["loading", "empty", "stale", "error", "restricted"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

const STATUS_TEXT: Record<StatusTone, string> = {
  loading: "Loading",
  empty: "Empty",
  stale: "Stale",
  error: "Error",
  restricted: "Restricted",
};

export function StatusBadge({ tone }: { tone: StatusTone }) {
  return (
    <span className={`ui-badge ui-badge-${tone}`} data-status={tone}>
      {STATUS_TEXT[tone]}
    </span>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <article className="ui-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="ui-card-title">
        {title}
      </h3>
      <div className="ui-card-body">{children}</div>
    </article>
  );
}

export function TextField({
  label,
  name,
  value,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
}) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className="ui-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type="text"
        autoComplete="off"
        value={value}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={hintId} className="ui-hint">
        {hint}
      </p>
    </div>
  );
}

export function ChartFrame({ title, tone, detail }: { title: string; tone: StatusTone; detail: string }) {
  const titleId = useId();
  return (
    <section className="ui-chart layout-charts" aria-labelledby={titleId}>
      <div className="ui-chart-head">
        <h3 id={titleId}>{title}</h3>
        <StatusBadge tone={tone} />
      </div>
      <div className="ui-chart-plot">
        <p>{detail}</p>
      </div>
    </section>
  );
}

export function PaginatedTable({
  caption,
  headers,
  rows,
  pageSize,
  pageIndex,
  onPageIndex,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly { cells: readonly string[] }[];
  pageSize: number;
  pageIndex?: number;
  onPageIndex?: (pageIndex: number) => void;
}) {
  const [uncontrolledPage, setUncontrolledPage] = useState(0);
  const page = pageIndex ?? uncontrolledPage;
  const setPage = onPageIndex ?? setUncontrolledPage;
  // The source does not define a page size. The caller supplies it.
  // A non-positive size renders no body rows, so the full row set stays out of the document.
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 0;
  const pageCount = size === 0 ? 1 : Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(page, pageCount - 1);
  const start = size === 0 ? 0 : safePage * size;
  const visible = size === 0 ? [] : rows.slice(start, start + size);

  return (
    <div className="layout-table">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={`${start + index}`}>
              {headers.map((header, cellIndex) => (
                <td key={header}>{row.cells[cellIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="layout-table-pages">
        <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
          Previous page
        </button>
        <span role="status">
          Page {safePage + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(safePage + 1)}
          disabled={size === 0 || safePage >= pageCount - 1}
        >
          Next page
        </button>
      </div>
    </div>
  );
}

export function LanguageChoice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="layout-language" role="group" aria-labelledby={labelId}>
      <span id={labelId}>{label}</span>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LanguageSample({
  label,
  lang,
  dir,
  parts,
}: {
  label: string;
  lang: string;
  dir: "ltr" | "rtl";
  parts: readonly string[];
}) {
  return (
    <div className="layout-sample-block">
      <span className="layout-sample-label">{label}</span>
      <p className="layout-sample" lang={lang} dir={dir} data-language-sample="">
        {parts.map((part, index) => (
          <span key={`${index}-${part}`} data-sample-part={index === 0 ? "first" : "second"}>
            {part}
          </span>
        ))}
      </p>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      const first = [...dialog.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")].find(
        (element) => !element.hasAttribute("disabled"),
      );
      first?.focus();
      return;
    }
    if (dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="layout-dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const items = [...dialog.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea")].filter(
          (element) => !element.hasAttribute("disabled"),
        );
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && dialog.contains(active);
        if (event.shiftKey && (!inside || active === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (!inside || active === last)) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      <button type="button" onClick={() => onCloseRef.current()}>
        Close
      </button>
    </dialog>
  );
}
