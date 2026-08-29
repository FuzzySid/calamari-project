"use client";

import { useState } from "react";
import { CountryMinimap } from "@/components/country-minimap";
import { PanoramaViewer } from "@/components/panorama-viewer";
import type { MinimapData } from "@/lib/minimap";
import type { PeriodStory } from "@/types";

type PeriodStoryPlayerProps = {
  story: PeriodStory;
  minimap: MinimapData | null;
};

export function PeriodStoryPlayer({ story, minimap }: PeriodStoryPlayerProps) {
  const [index, setIndex] = useState(0);
  const moments = story.moments;
  const moment = moments[index];

  const go = (next: number) => {
    setIndex(Math.min(moments.length - 1, Math.max(0, next)));
  };

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden bg-black text-mist">
      <div key={moment.id} className="absolute inset-0 flex animate-[fadeIn_700ms_ease]">
        {moment.videoPath ? (
          <PanoramaViewer
            mediaType="video"
            src={moment.videoPath}
            title={moment.title}
            initialYaw={180}
            minYaw={80}
            maxYaw={280}
            minimal
          />
        ) : (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${moment.imagePath})` }}
          />
        )}
      </div>

      <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-center sm:right-8 sm:top-6">
        {minimap && (
          <CountryMinimap
            data={minimap}
            activeIndex={index}
            onSelect={go}
            className="drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]"
          />
        )}
        <p className="mt-1.5 max-w-[140px] text-center text-[10px] uppercase leading-4 tracking-[0.16em] text-gold/90 [text-shadow:0_1px_6px_rgba(0,0,0,.9)]">
          {moment.location.label}
        </p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-6 pb-6 pt-16 sm:px-10 sm:pb-8">
        <div className="mx-auto flex max-w-5xl items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-2xl leading-tight [text-shadow:0_1px_10px_rgba(0,0,0,.85)] sm:text-3xl">
              {moment.title}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-mist/90 [text-shadow:0_1px_8px_rgba(0,0,0,.85)] sm:text-base">
              {moment.narrativeCopy}
            </p>
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous scene"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/40 text-lg backdrop-blur-sm transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-25"
            >
              ‹
            </button>
            <span className="text-[11px] tracking-[0.2em] text-mist/70">
              {index + 1}/{moments.length}
            </span>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === moments.length - 1}
              aria-label="Next scene"
              className="grid h-10 w-10 place-items-center rounded-full border border-gold/50 bg-gold/15 text-lg text-gold backdrop-blur-sm transition hover:bg-gold/25 disabled:pointer-events-none disabled:opacity-25"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
