"use client";

import React, { useEffect, useId, useState } from "react";
import type { CalaResearchRecord } from "@/types";

type CalaResearchTooltipProps = {
  momentId: string;
  research: CalaResearchRecord;
};

export function ResearchBookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 10.5c3.8-.4 7.1.7 10.5 3.4v12c-3.4-2.7-6.7-3.8-10.5-3.4v-12Z" />
      <path d="M26.5 10.5c-3.8-.4-7.1.7-10.5 3.4v12c3.4-2.7 6.7-3.8 10.5-3.4v-12Z" />
      <path d="m16 3.5.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
      <path d="m25.5 4 .4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4.4-1Z" />
    </svg>
  );
}

export function isSafeResearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

type ResearchFactsNoteProps = {
  momentId: string;
  research: CalaResearchRecord;
};

export function ResearchFactsNote({ momentId, research }: ResearchFactsNoteProps) {
  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-[#c7ad78] bg-[#f3e6bd] p-5 pb-4 text-[#1c2630] shadow-[0_16px_44px_rgba(0,0,0,.52)] sm:p-6 sm:pb-5">
      <span aria-hidden="true" className="absolute -top-1.5 left-7 h-3 w-7 rounded-b-sm bg-[#a55a35] shadow-sm" />
      <h2 className="font-display text-2xl leading-none sm:text-3xl">{research.timeline}</h2>
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
        <ul className="space-y-2.5 text-sm leading-5 marker:text-[#a55a35] sm:text-[15px] sm:leading-6">
          {research.facts.slice(0, 5).map((fact, index) => (
            <li key={`${momentId}-fact-${index}`} className="ml-4 pl-1">{fact}</li>
          ))}
        </ul>
      </div>
      {research.entities.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Related entities">
          {research.entities.map((entity) => (
            <span key={`${entity.name}-${entity.type ?? "entity"}`} className="border border-[#b89665] bg-[#ead8a7] px-2 py-1 text-[10px] font-medium tracking-wide text-[#573d28]">
              {entity.name}{entity.type ? ` · ${entity.type}` : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

type ResearchSourcesNoteProps = {
  research: CalaResearchRecord;
};

export function ResearchSourcesNote({ research }: ResearchSourcesNoteProps) {
  return (
    <section className="relative flex min-h-0 flex-[0.8] flex-col overflow-hidden border border-[#b89564] bg-[#e7d09a] p-4 text-[#1c2630] shadow-[0_12px_32px_rgba(0,0,0,.48)] sm:ml-4">
      <span aria-hidden="true" className="absolute -top-1.5 right-7 h-3 w-7 rounded-b-sm bg-[#2d6f73] shadow-sm" />
      <p className="font-mono text-[8px] uppercase tracking-[0.19em] text-[#835330]">Cala Sources</p>
      <ul className="mt-2.5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-[11px] leading-4">
        {research.sources.map((source, index) => {
          const safeUrl = isSafeResearchUrl(source.url);
          const label = source.date ? `${source.publisher} · ${source.date}` : source.publisher;

          return (
            <li key={`${source.publisher}-${index}`}>
              {safeUrl ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#6f3924] underline decoration-[#a55a35]/70 underline-offset-2 transition hover:text-[#3f241a] focus:outline-none focus:ring-2 focus:ring-[#a55a35] focus:ring-offset-2 focus:ring-offset-[#e7d09a] motion-reduce:transition-none"
                >
                  {label} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span>{label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CalaResearchTooltip({ momentId, research }: CalaResearchTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    setIsOpen(false);
  }, [momentId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={isOpen ? "Close story facts" : "Open story facts"}
        className="pointer-events-auto mt-4 grid h-9 w-9 place-items-center rounded-full border border-gold/60 bg-ink/80 text-gold shadow-[0_5px_18px_rgba(0,0,0,.4)] backdrop-blur-sm transition hover:scale-105 hover:border-gold hover:bg-ink/95 focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-ink motion-reduce:transform-none motion-reduce:transition-none"
      >
        <ResearchBookIcon />
      </button>

      {isOpen && (
        <aside
          id={panelId}
          aria-label="Story facts"
          className="pointer-events-auto fixed inset-x-4 bottom-[7.25rem] z-30 flex max-h-[min(60dvh,32rem)] flex-col gap-3 overflow-hidden sm:inset-x-auto sm:right-6 sm:top-52 sm:bottom-28 sm:w-[23rem] sm:max-h-none"
        >
          <ResearchFactsNote momentId={momentId} research={research} />
          <ResearchSourcesNote research={research} />
        </aside>
      )}
    </>
  );
}
