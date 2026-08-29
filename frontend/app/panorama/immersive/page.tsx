"use client";

import { useSearchParams } from "next/navigation";
import { PanoramaViewer } from "@/components/panorama-viewer";

export default function ImmersivePanoramaPage() {
  const searchParams = useSearchParams();
  const place = searchParams.get("place")?.trim() || "Granada";
  const period = searchParams.get("period")?.trim() || "1492";

  return (
    <main className="relative flex h-screen w-screen overflow-hidden bg-black text-white">
      <PanoramaViewer
        mediaType="video"
        src="/panoramas/castle-panorama.mp4"
        title={`${place} — ${period}`}
        initialYaw={-90}
        minimal
      />

      <p className="pointer-events-none absolute right-4 top-4 z-20 max-w-[75vw] text-right text-[11px] font-medium tracking-[0.08em] text-white/65 [text-shadow:0_1px_8px_rgba(0,0,0,.8)] sm:right-6 sm:top-5 sm:text-xs">
        {place} — {period}
      </p>
    </main>
  );
}
