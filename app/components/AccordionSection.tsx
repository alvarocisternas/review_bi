"use client";

import type { ReactNode } from "react";

interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Shared single-section accordion header + body, used by both
 * ComparativeDashboard and AnalysisDashboard so the two dashboards' collapse
 * behavior and styling never drift apart. The parent owns which section is
 * open (a single `openSection` state, `null` meaning none) and passes
 * `isOpen`/`onToggle` down — this component itself is stateless.
 *
 * The whole header bar is clickable, shows a chevron that flips on open,
 * and the title grows one step in size/weight when open. Closed content is
 * not rendered at all (no display:none), matching the original pattern.
 */
export default function AccordionSection({
  title,
  isOpen,
  onToggle,
  children,
}: AccordionSectionProps) {
  return (
    <div className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <h3
          className={`transition-all duration-200 text-zinc-900 dark:text-zinc-100 ${
            isOpen ? "text-base font-bold" : "text-sm font-semibold"
          }`}
        >
          {title}
        </h3>
        <span
          className={`text-zinc-500 transition-transform duration-200 dark:text-zinc-400 ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        >
          ⌄
        </span>
      </button>
      {isOpen && <div className="px-1 pt-2">{children}</div>}
    </div>
  );
}
