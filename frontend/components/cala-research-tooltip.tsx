"use client";

import { useEffect, useId, useState } from "react";
import type { CalaResearchRecord } from "@/types";

type CalaResearchTooltipProps = {
  momentId: string;
  research: CalaResearchRecord;
};

export function isSafeResearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
        className="pointer-events-auto mt-4 inline-flex items-center gap-2 rounded-sm border border-gold/45 bg-ink/75 px-3 py-2 text-left text-[10px] font-medium uppercase tracking-[0.16em] text-gold shadow-[0_5px_18px_rgba(0,0,0,.4)] backdrop-blur-sm transition hover:border-gold hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-ink motion-reduce:transition-none"
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#a55a35] shadow-[0_0_0_2px_rgba(202,139,90,.2)]" />
        Story by Cala
        <span aria-hidden="true" className="text-sm leading-none">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen && (
        <aside
          id={panelId}
          aria-label="Story by Cala notes"
          className="pointer-events-auto fixed inset-x-5 bottom-[7.25rem] z-30 flex max-h-[min(51dvh,25rem)] flex-col gap-2.5 overflow-hidden sm:inset-x-auto sm:right-6 sm:top-52 sm:bottom-28 sm:w-[19rem] sm:max-h-none"
        >
          <section className="relative flex min-h-0 flex-[1.15] flex-col overflow-hidden border border-[#c7ad78] bg-[#f3e6bd] p-4 pb-3 text-[#1c2630] shadow-[0_12px_32px_rgba(0,0,0,.48)]">
            <span aria-hidden="true" className="absolute -top-1.5 left-7 h-3 w-7 rounded-b-sm bg-[#a55a35] shadow-sm" />
            <p className="font-mono text-[8px] uppercase tracking-[0.19em] text-[#835330]">Story by Cala · facts</p>
            <h2 className="mt-1.5 font-display text-xl leading-none">{research.timeline}</h2>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1.5">
              <ul className="space-y-1.5 text-[13px] leading-[1.15rem] marker:text-[#a55a35]">
                {research.facts.slice(0, 5).map((fact, index) => (
                  <li key={`${momentId}-fact-${index}`} className="ml-4 pl-1">{fact}</li>
                ))}
              </ul>
            </div>
            {research.entities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1" aria-label="Related entities">
                {research.entities.map((entity) => (
                  <span key={`${entity.name}-${entity.type ?? "entity"}`} className="border border-[#b89665] bg-[#ead8a7] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-[#573d28]">
                    {entity.name}{entity.type ? ` · ${entity.type}` : ""}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden border border-[#b89564] bg-[#e7d09a] p-4 text-[#1c2630] shadow-[0_12px_32px_rgba(0,0,0,.48)] sm:ml-4">
            <span aria-hidden="true" className="absolute -top-1.5 right-7 h-3 w-7 rounded-b-sm bg-[#2d6f73] shadow-sm" />
            <p className="font-mono text-[8px] uppercase tracking-[0.19em] text-[#835330]">Cala provenance · sources</p>
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
        </aside>
      )}
    </>
  );
}
