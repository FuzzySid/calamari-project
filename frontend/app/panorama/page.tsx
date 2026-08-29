"use client";

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

        <p className="pointer-events-none absolute right-4 top-4 z-20 max-w-[75vw] text-right text-[11px] font-medium tracking-[0.08em] text-white/65 [text-shadow:0_1px_8px_rgba(0,0,0,.8)] sm:right-6 sm:top-5 sm:text-xs">
          {countryLabel}
        </p>
      </main>
    );
  }

  return <PanoramaTimeline country={countryLabel} />;
}
