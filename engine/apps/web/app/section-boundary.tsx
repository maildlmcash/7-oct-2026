"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { ErrorState } from "@crypto-prediction-engine/ui-kit";
import { recordPageHealth } from "../page-health.mjs";
import {
  CORRELATION_HEADER,
  diagnosticEvent,
  resolveCorrelationId,
  SECTION_HEADER,
  type DiagnosticEvent,
} from "../request-correlation.mjs";

type DiagnosticWindow = Window & {
  __shellDiagnostics?: DiagnosticEvent[];
  __injectSectionError?: string;
};

function rememberDiagnostic(event: DiagnosticEvent) {
  if (typeof window === "undefined") return;
  const target = window as DiagnosticWindow;
  const events = target.__shellDiagnostics ?? [];
  events.push(event);
  target.__shellDiagnostics = events;
}

function rememberPageHealth(input: {
  routeViewId: string;
  viewId?: string | null;
  httpStatus: number | null;
  exception?: boolean;
  requestId: string;
  environment?: string | null;
}) {
  const event = recordPageHealth({
    routeViewId: input.routeViewId,
    viewId: input.viewId,
    httpStatus: input.httpStatus,
    exception: input.exception === true ? true : null,
    requestId: input.requestId,
    environment: input.environment,
  });
  if (typeof window === "undefined") return;
  const target = window as DiagnosticWindow & { __pageHealthEvents?: unknown[] };
  const events = target.__pageHealthEvents ?? [];
  events.push(event);
  target.__pageHealthEvents = events;
}

function InjectedSectionFailure({ section }: { section: string }) {
  if (typeof window !== "undefined" && (window as DiagnosticWindow).__injectSectionError === section) {
    throw new Error("injected section render failure");
  }
  return null;
}

// The boundary covers the panel body only. Navigation and the section heading stay mounted.
export class SectionErrorBoundary extends Component<
  { section: string; environment?: string | null; children: ReactNode },
  { correlationId: string | null }
> {
  state = { correlationId: null as string | null };
  private recorded: string | null = null;

  static getDerivedStateFromError() {
    return { correlationId: crypto.randomUUID() };
  }

  componentDidMount() {
    this.record();
  }

  componentDidUpdate() {
    this.record();
  }

  private record() {
    const correlationId = this.state.correlationId;
    if (!correlationId || this.recorded === correlationId) return;
    this.recorded = correlationId;
    rememberDiagnostic(
      diagnosticEvent({
        correlationId,
        section: this.props.section,
        route: "section-render",
        httpStatus: null,
      }),
    );
    rememberPageHealth({
      routeViewId: "section-render",
      viewId: this.props.section,
      httpStatus: null,
      exception: true,
      requestId: correlationId,
      environment: this.props.environment,
    });
  }

  render() {
    if (this.state.correlationId) {
      return (
        <div data-correlation-id={this.state.correlationId}>
          <ErrorState>Section render failed {this.state.correlationId}</ErrorState>
        </div>
      );
    }
    return (
      <>
        <InjectedSectionFailure section={this.props.section} />
        {this.props.children}
      </>
    );
  }
}

export function SectionRequest({
  section,
  pageSize,
  environment = null,
  children,
}: {
  section: string;
  pageSize: number;
  environment?: string | null;
  children: ReactNode;
}) {
  const [failure, setFailure] = useState<DiagnosticEvent | null>(null);

  useEffect(() => {
    const clientId = crypto.randomUUID();
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const response = await fetch(`/api/view-state?pageSize=${pageSize}`, {
          cache: "no-store",
          headers: {
            [CORRELATION_HEADER]: clientId,
            [SECTION_HEADER]: section,
          },
          signal: controller.signal,
        });
        if (!active) return;
        const correlationId = resolveCorrelationId(response.headers.get(CORRELATION_HEADER) ?? clientId);
        if (!response.ok) {
          const event = diagnosticEvent({
            correlationId,
            section,
            route: "/api/view-state",
            httpStatus: response.status,
          });
          rememberDiagnostic(event);
          rememberPageHealth({
            routeViewId: "/api/view-state",
            viewId: section,
            httpStatus: response.status,
            requestId: correlationId,
            environment,
          });
          setFailure(event);
          return;
        }
        let ok = false;
        try {
          const body: unknown = await response.json();
          ok = Boolean(body) && typeof body === "object" && (body as { ok?: unknown }).ok === true;
        } catch {
          ok = false;
        }
        if (!active) return;
        if (!ok) {
          const event = diagnosticEvent({
            correlationId,
            section,
            route: "/api/view-state",
            httpStatus: response.status,
          });
          rememberDiagnostic(event);
          setFailure(event);
          return;
        }
        setFailure(null);
      } catch {
        if (!active || controller.signal.aborted) return;
        const event = diagnosticEvent({
          correlationId: clientId,
          section,
          route: "/api/view-state",
          httpStatus: null,
        });
        rememberDiagnostic(event);
        rememberPageHealth({
          routeViewId: "/api/view-state",
          viewId: section,
          httpStatus: null,
          exception: true,
          requestId: clientId,
          environment,
        });
        setFailure(event);
      }
    }

    setFailure(null);
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [environment, pageSize, section]);

  return (
    <>
      {failure ? (
        <div data-correlation-id={failure.correlationId}>
          <ErrorState>Section request failed {failure.correlationId}</ErrorState>
        </div>
      ) : null}
      {children}
    </>
  );
}
