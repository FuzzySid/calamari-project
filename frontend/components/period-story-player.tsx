"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CountryMinimap } from "@/components/country-minimap";
import type { MinimapData } from "@/lib/minimap";
import type { PeriodStory } from "@/types";

type PeriodStoryPlayerProps = {
  story: PeriodStory;
  minimap: MinimapData | null;
};

const FADE_MS = 700;

export function PeriodStoryPlayer({ story, minimap }: PeriodStoryPlayerProps) {
  const [index, setIndex] = useState(0);
  const moments = story.moments;
  const moment = moments[index];
  const isLast = index === moments.length - 1;

  const go = useCallback(
    (next: number) => {
      setIndex(Math.min(moments.length - 1, Math.max(0, next)));
    },
    [moments.length]
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight" || event.key === " ") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, go]);

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-ink text-mist">
      {moments.map((item, i) => (
        <div
          key={item.id}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${item.imagePath})`,
            opacity: i === index ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease`
          }}
        />
      ))}

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/15" />

      <Link
        href="/"
        className="absolute left-6 top-6 z-20 rounded-full border border-white/20 bg-black/30 px-4 py-2 text-sm text-mist backdrop-blur-sm transition hover:bg-white/10 sm:left-10 sm:top-8"
      >
        Back to globe
      </Link>

      <div className="absolute right-6 top-6 z-20 flex flex-col items-center rounded-2xl border border-white/15 bg-black/35 p-3 backdrop-blur-sm sm:right-10 sm:top-8">
        {minimap && <CountryMinimap data={minimap} activeIndex={index} />}
        <p className="mt-2 max-w-[140px] text-center text-[10px] uppercase leading-4 tracking-[0.18em] text-gold/85">
          {moment.location.label}
        </p>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-8 sm:px-10 sm:pb-12 lg:px-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl" key={moment.id}>
            <p className="text-xs uppercase tracking-[0.35em] text-gold/80">
              {story.eraLabel} · {String(index + 1).padStart(2, "0")} /{" "}
              {String(moments.length).padStart(2, "0")}
            </p>
            <h1 className="mt-3 font-display text-3xl leading-tight sm:text-5xl">
              {moment.title}
            </h1>
            <p className="mt-4 text-base leading-7 text-mist/88 sm:text-lg">
              {moment.narrativeCopy}
            </p>

            <div className="mt-5 border-l-2 border-gold/60 pl-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-gold/70">
                Verified by Cala
              </p>
              <p className="mt-2 max-w-xl text-xs leading-6 text-mist/72 sm:text-sm">
                {moment.factText}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 pb-1">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="rounded-full border border-white/20 bg-black/30 px-5 py-3 text-sm text-mist backdrop-blur-sm transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
            >
              Back
            </button>
            {isLast ? (
              <Link
                href="/"
                className="rounded-full border border-gold/50 bg-gold/15 px-6 py-3 text-sm uppercase tracking-[0.2em] text-gold backdrop-blur-sm transition hover:bg-gold/25"
              >
                The end · Globe
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => go(index + 1)}
                className="rounded-full border border-gold/50 bg-gold/15 px-8 py-3 text-sm uppercase tracking-[0.2em] text-gold backdrop-blur-sm transition hover:bg-gold/25"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
