"use client";

import { useEffect, useRef, useState } from "react";
import {
  Heading,
  LanguageChoice,
  LanguageSample,
  Panel,
  SectionNav,
} from "@crypto-prediction-engine/ui-kit";
import "@crypto-prediction-engine/ui-kit/layout.css";
import "./styles.css";
import {
  initialClientViewState,
  selectSection,
  setPageIndex,
  SHELL_SECTIONS,
  type ClientViewState,
  type ShellSection,
} from "@crypto-prediction-engine/contracts";
import { renderSectionCapability } from "../../../services/shell-capabilities.mjs";
import { deskSections, isDeskRole } from "../../../services/desk-roles.mjs";
import { ModelHealthCharts } from "./model-health-charts";
import { SectionErrorBoundary, SectionRequest } from "./section-boundary";
import { DeskAuth, type DeskSession } from "./desk-auth";
import { EngineWorkspace } from "./engine-workspace";
import { RoleNav, type RoleNavigationModel } from "./navigation/role-nav";
import { TenantBrand, type TenantResolution } from "./branding/tenant-brand";

export { SHELL_SECTIONS };
export type { ShellSection };

// Task 1.A.2: one pathname, client view state, no full-page reload.
// Section changes call history.pushState with the current pathname.
// Back and forward read shellSection and select that section.
// A reload ignores history state and returns to Dashboard.
// The view contract also resets filters, pagination, and user-visible status.

const SHELL_HISTORY_KEY = "shellSection";

// Next.js replaces window.history.pushState. Calling that copy reloads the
// app route. An untouched History.prototype from a fresh frame writes the
// same pathname without a document navigation.
function nativeHistory() {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  document.documentElement.appendChild(frame);
  const historyApi = frame.contentWindow?.history;
  const pushState = historyApi?.pushState;
  const replaceState = historyApi?.replaceState;
  frame.remove();
  const sameUrl = () => `${window.location.pathname}${window.location.search}`;
  function tagged(section: string) {
    const current = window.history.state;
    const base = current && typeof current === "object" ? { ...current } : {};
    base[SHELL_HISTORY_KEY] = section;
    return base;
  }
  return {
    push(section: string) {
      pushState?.call(window.history, tagged(section), "", sameUrl());
    },
    replace(section: string) {
      replaceState?.call(window.history, tagged(section), "", sameUrl());
    },
  };
}

export type ShellCapabilities = {
  editChecklist: boolean;
  userChecklist: boolean;
  market: boolean;
};

// Language tags are the BCP 47 tags for the three languages named by TASK 03.B.02.
// The source does not list a theme. Section names stay the canonical English labels.
const SHELL_LANGUAGES = [
  { id: "en", label: "English", lang: "en", dir: "ltr", parts: ["English", "sample"] },
  { id: "hi", label: "Hindi", lang: "hi", dir: "ltr", parts: ["हिंदी", "अक्षर"] },
  { id: "ur", label: "Urdu", lang: "ur", dir: "rtl", parts: ["اردو", "نمونہ"] },
] as const;

export default function Shell({
  checklistMarkup,
  capabilities,
  status,
  environment = null,
  navigation = null,
  branding,
  previews,
}: {
  checklistMarkup: string;
  capabilities: ShellCapabilities;
  status: ClientViewState["status"];
  environment?: string | null;
  navigation?: RoleNavigationModel | null;
  branding: TenantResolution;
  previews: TenantResolution[];
}) {
  const [view, setView] = useState(() => {
    const initial = initialClientViewState({ pageSize: 1, status });
    if (!initial.ok) throw new Error(initial.error);
    return initial.state;
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [session, setSession] = useState<DeskSession | null>(null);
  const [languageId, setLanguageId] = useState<(typeof SHELL_LANGUAGES)[number]["id"]>("en");
  const language = SHELL_LANGUAGES.find((item) => item.id === languageId) ?? SHELL_LANGUAGES[0];
  const section = view.section;
  const signedRole = session && isDeskRole(session.role) ? session.role : null;
  const allowedSections = signedRole ? deskSections(signedRole) : null;
  const effectiveCapabilities: ShellCapabilities = signedRole === "Admin"
    ? { editChecklist: true, userChecklist: false, market: false }
    : signedRole === "User"
      ? { editChecklist: false, userChecklist: true, market: false }
      : capabilities;
  const sectionMarkup = renderSectionCapability(effectiveCapabilities, section, checklistMarkup);
  const visibleSections = allowedSections
    ? SHELL_SECTIONS.filter((name) => allowedSections.includes(name))
    : SHELL_SECTIONS;
  const adminLocked = (section === "Admin" || section === "Bugs") && signedRole !== "Admin";

  function commitSection(id: string, record: boolean) {
    const current = viewRef.current;
    if (id === current.section) return false;
    const selected = selectSection(current, id);
    if (!selected.ok) return false;
    const paged = setPageIndex(selected.state, 0);
    if (!paged.ok) return false;
    viewRef.current = paged.state;
    setView(paged.state);
    if (record) nativeHistory().push(id);
    return true;
  }

  function chooseSection(id: string) {
    commitSection(id, true);
  }

  useEffect(() => {
    const current = window.history.state as { shellSection?: string } | null;
    if (!current || typeof current.shellSection !== "string") {
      nativeHistory().replace("Dashboard");
    }
    function onPop(event: PopStateEvent) {
      const state = event.state as { shellSection?: string } | null;
      const next = state && typeof state.shellSection === "string" ? state.shellSection : "Dashboard";
      commitSection(next, false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function applySession(next: DeskSession | null) {
    setSession(next);
    if (next?.role === "User" && (view.section === "Admin" || view.section === "Bugs")) {
      chooseSection("Dashboard");
    }
    if (next?.role === "Admin") chooseSection("Admin");
  }

  useEffect(() => {
    document.documentElement.lang = language.lang;
    document.documentElement.dir = language.dir;
  }, [language.lang, language.dir]);

  useEffect(() => {
    const mark = () => {
      for (const node of document.querySelectorAll(".table-scroll")) {
        if (node instanceof HTMLElement && node.tabIndex < 0) node.tabIndex = 0;
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="layout-shell">
      <header className="shell-header">
        <div className="app-masthead"><p className="layout-mark">crypto-prediction-engine</p><span className="safety-banner"><i />LIVE ORDERS LOCKED</span><span className={signedRole === "Admin" ? "pill pill-live" : "pill"}>{signedRole ? `${signedRole} role` : "Signed out"}</span></div>
        <nav aria-label="Breadcrumb">
          <ol className="shell-crumbs">
            <li>crypto-prediction-engine</li>
            <li aria-current="page">{section}</li>
          </ol>
        </nav>
      </header>
      <LanguageChoice
        label="Language"
        options={SHELL_LANGUAGES}
        value={language.id}
        onChange={(id) => {
          const match = SHELL_LANGUAGES.find((item) => item.id === id);
          if (match) setLanguageId(match.id);
        }}
      />
      <LanguageSample label="Language sample" lang={language.lang} dir={language.dir} parts={language.parts} />
      <TenantBrand applied={branding} previews={previews} />
      <SectionNav
        label="Sections"
        items={visibleSections.map((name) => ({
          id: name,
          label: name,
          pressed: section === name,
        }))}
        onSelect={chooseSection}
      />
      <RoleNav model={navigation} onOpen={chooseSection} />
      <DeskAuth session={session} onSession={applySession} />
      <main>
      <Panel labelledBy="section-title">
        <Heading id="section-title">{section}</Heading>
        <SectionErrorBoundary key={section} section={section} environment={environment}>
          <SectionRequest section={section} pageSize={100} environment={environment}>
            {adminLocked ? (
              <article className="card desk-lock">
                <span className="pill pill-warn">ADMIN ONLY</span>
                <h2>Admin login required</h2>
                <p>यह सेक्शन सिर्फ Admin रोल के लिए है। User रोल इसे नहीं खोल सकता। Live orders locked रहते हैं।</p>
              </article>
            ) : (
              <>
                {sectionMarkup ? <div dangerouslySetInnerHTML={{ __html: sectionMarkup }} /> : null}
                <EngineWorkspace section={section} onNavigate={chooseSection} canEditChecklist={signedRole === "Admin"} checklistCsrf={session?.csrfToken ?? null} />
                {section === "Predictions" ? <ModelHealthCharts bound={100} /> : null}
              </>
            )}
          </SectionRequest>
        </SectionErrorBoundary>
      </Panel>
      </main>
    </div>
  );
}
