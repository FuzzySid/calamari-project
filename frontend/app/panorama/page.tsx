"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PanoramaViewer } from "@/components/panorama-viewer";
import { PanoramaTimeline } from "@/components/panorama-timeline";

export default function PanoramaPage() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country") ?? "Spain";
  const countryLabel = country.trim() || "Spain";
  const isSpain = countryLabel.toLowerCase() === "spain";

  if (isSpain) {
    return (
      <main className="relative flex h-screen w-screen overflow-hidden bg-black text-white">
        <PanoramaViewer
          mediaType="video"
          src="/panoramas/spain/event.mp4"
          title={`${countryLabel} panorama`}
          initialYaw={-90}
          minimal
        />

        <Link
          href="/"
          className="absolute left-4 top-4 z-20 rounded-full border border-white/15 bg-black/45 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-white/85 backdrop-blur-md transition hover:bg-black/65 sm:left-6 sm:top-5"
        >
          Back
        </Link>

        <p className="pointer-events-none absolute right-4 top-4 z-20 max-w-[75vw] text-right text-[11px] font-medium tracking-[0.08em] text-white/65 [text-shadow:0_1px_8px_rgba(0,0,0,.8)] sm:right-6 sm:top-5 sm:text-xs">
          {countryLabel}
        </p>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-6 pt-16 sm:px-6">
          <p className="max-w-2xl text-sm leading-6 text-white/82 [text-shadow:0_1px_8px_rgba(0,0,0,.7)] sm:text-[15px]">
            Archival panorama depicting a pivotal wartime moment in Spain, with aircraft overhead and civilians moving through a town under bombardment.
          </p>
        </div>
      </main>
    );
  }

  return <PanoramaTimeline country={countryLabel} />;
}
