"use client";

import { useEffect, useState } from "react";
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
import { ModelHealthCharts } from "./model-health-charts";
import { SectionErrorBoundary, SectionRequest } from "./section-boundary";
import { EngineWorkspace } from "./engine-workspace";

export { SHELL_SECTIONS };
export type { ShellSection };

// Design section 23: one pathname, client view state, no full-page reload.
// History is not updated, so browser back and forward do not select a section.
// A reload returns to Dashboard, the first named section.
// The view contract also resets filters, pagination, and user-visible status.

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
}: {
  checklistMarkup: string;
  capabilities: ShellCapabilities;
  status: ClientViewState["status"];
  environment?: string | null;
}) {
  const [view, setView] = useState(() => {
    const initial = initialClientViewState({ pageSize: 1, status });
    if (!initial.ok) throw new Error(initial.error);
    return initial.state;
  });
  const [languageId, setLanguageId] = useState<(typeof SHELL_LANGUAGES)[number]["id"]>("en");
  const language = SHELL_LANGUAGES.find((item) => item.id === languageId) ?? SHELL_LANGUAGES[0];
  const section = view.section;
  const sectionMarkup = renderSectionCapability(capabilities, section, checklistMarkup);

  function chooseSection(id: string) {
    if (id === view.section) return;
    const selected = selectSection(view, id);
    if (!selected.ok) return;
    const paged = setPageIndex(selected.state, 0);
    if (paged.ok) setView(paged.state);
  }

  useEffect(() => {
    document.documentElement.lang = language.lang;
    document.documentElement.dir = language.dir;
  }, [language.lang, language.dir]);

  return (
    <main className="layout-shell">
      <div className="app-masthead"><p className="layout-mark">crypto-prediction-engine</p><span className="safety-banner"><i />LIVE ORDERS LOCKED</span></div>
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
      <SectionNav
        label="Sections"
        items={SHELL_SECTIONS.map((name) => ({
          id: name,
          label: name,
          pressed: section === name,
        }))}
        onSelect={chooseSection}
      />
      <Panel labelledBy="section-title">
        <Heading id="section-title">{section}</Heading>
        <SectionErrorBoundary key={section} section={section} environment={environment}>
          <SectionRequest section={section} pageSize={100} environment={environment}>
            {sectionMarkup ? <div dangerouslySetInnerHTML={{ __html: sectionMarkup }} /> : null}
            <EngineWorkspace section={section} onNavigate={chooseSection} />
            {section === "Predictions" ? <ModelHealthCharts bound={100} /> : null}
          </SectionRequest>
        </SectionErrorBoundary>
      </Panel>
    </main>
  );
}
