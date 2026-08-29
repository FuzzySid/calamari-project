"use client";

import { useSearchParams } from "next/navigation";
import { PanoramaTimeline } from "@/components/panorama-timeline";

export default function PanoramaPage() {
  const searchParams = useSearchParams();
  const country = searchParams.get("country") ?? "Spain";
  const countryLabel = country.trim() || "Spain";

  return <PanoramaTimeline country={countryLabel} />;
}
