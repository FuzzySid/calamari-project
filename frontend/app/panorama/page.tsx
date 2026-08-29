"use client";

import Link from "next/link";
import { useState } from "react";
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
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const panorama = PANORAMAS[mediaType];

  return (
    <main className="min-h-screen bg-ink px-4 py-4 text-mist sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[100rem] flex-col sm:min-h-[calc(100vh-3rem)]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              href="/"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-mist/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-gold/70"
            >
              Back to globe
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-gold/80">Experimental view</p>
              <h1 className="mt-1 font-display text-2xl sm:text-3xl">Step inside the moment</h1>
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

        <section className="flex min-h-[28rem] flex-1 overflow-hidden rounded-[1.75rem] border border-white/15 shadow-glow">
          <PanoramaViewer
            key={mediaType}
            mediaType={mediaType}
            src={panorama.src}
            title={`Historical castle ${panorama.label}`}
            initialYaw={-90}
          />
        </section>
      </div>
    </main>
  );
}
