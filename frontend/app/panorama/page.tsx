"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PanoramaViewer } from "@/components/panorama-viewer";

type MediaType = "image" | "video";

const PANORAMAS: Record<MediaType, { src: string; label: string }> = {
  image: {
    src: "/panoramas/castle-panorama.jpg",
    label: "360° image"
  },
  video: {
    src: "/panoramas/castle-panorama.mp4",
    label: "360° video"
  }
};

export default function PanoramaPage() {
  const searchParams = useSearchParams();
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const panorama = PANORAMAS[mediaType];
  const country = searchParams.get("country") ?? "Spain";
  const countryLabel = country.trim() || "Spain";
  const place = searchParams.get("place") ?? "Historical castle panorama";
  const period = searchParams.get("period") ?? "Demo historical environment";
  const eventId = searchParams.get("event");
  const returnHref = eventId ? `/story/ESP/${encodeURIComponent(eventId)}` : "/";

  return (
    <main className="min-h-screen bg-ink px-4 py-4 text-mist sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[100rem] flex-col sm:min-h-[calc(100vh-3rem)]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              href={returnHref}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-mist/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-gold/70"
            >
              {eventId ? "Back to story" : "Back to globe"}
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gold/80">Experimental view</p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl">Step inside the moment</h1>
              <p className="mt-2 text-sm text-mist/70">Drag, zoom, and look around the reconstructed scene.</p>
            </div>
          </div>

          <div className="flex rounded-full border border-white/15 bg-white/5 p-1" aria-label="Panorama type">
            {(Object.keys(PANORAMAS) as MediaType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMediaType(type)}
                aria-pressed={mediaType === type}
                className={`rounded-full px-4 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-gold/70 ${
                  mediaType === type ? "bg-gold text-ink" : "text-mist/70 hover:text-mist"
                }`}
              >
                {PANORAMAS[type].label}
              </button>
            ))}
          </div>
        </header>

        <section className="relative flex min-h-[28rem] flex-1 overflow-hidden rounded-[1.75rem] border border-white/15 shadow-glow">
          <PanoramaViewer
            key={mediaType}
            mediaType={mediaType}
            src={panorama.src}
            title={`Historical castle ${panorama.label}`}
            initialYaw={-90}
          />

          <div className="pointer-events-none absolute right-4 top-4 z-20 max-w-[min(22rem,70vw)] rounded-[1.25rem] border border-white/15 bg-black/45 p-4 text-right shadow-xl backdrop-blur-lg sm:right-6 sm:top-6 sm:p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-gold/80">{countryLabel}</p>
            <h2 className="mt-2 font-display text-xl text-mist sm:text-2xl">{place}</h2>
            <p className="mt-1 text-xs text-mist/62 sm:text-sm">{period}</p>
          </div>

          <aside className="absolute bottom-20 right-6 z-20 hidden w-64 overflow-hidden rounded-[1.35rem] border border-white/15 bg-black/48 shadow-2xl backdrop-blur-xl lg:block">
            <div className="relative h-24 overflow-hidden border-b border-white/10 bg-[#102b3e]">
              <svg viewBox="0 0 300 110" className="absolute inset-0 h-full w-full" aria-hidden="true">
                <path d="M22 53 C55 21 88 34 105 51 C125 72 149 61 165 44 C187 19 228 27 278 52 C254 70 225 78 199 70 C172 62 153 82 124 85 C86 89 51 76 22 53Z" fill="#647b65" opacity=".85" />
                <path d="M142 42 l10 14 -10 14 -10 -14z" fill="#d4b16a" />
                <circle cx="142" cy="56" r="13" fill="none" stroke="#d4b16a" opacity=".5" />
              </svg>
              <p className="absolute left-4 top-3 text-[10px] uppercase tracking-[0.24em] text-mist/65">Same period · demo</p>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-mist">Spain</span>
                <span className="rounded-full bg-gold/20 px-2 py-1 text-[10px] uppercase tracking-wider text-gold">Current</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-mist/40">
                <span>Portugal</span>
                <span className="text-[10px] uppercase tracking-wider">Coming soon</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-mist/40">
                <span>Morocco</span>
                <span className="text-[10px] uppercase tracking-wider">Coming soon</span>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
