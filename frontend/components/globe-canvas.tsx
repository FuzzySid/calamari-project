"use client";

import { useEffect, useRef } from "react";
import Globe from "react-globe.gl";

export type GlobeControls = {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (type: "start" | "change" | "end", listener: () => void) => void;
  removeEventListener: (type: "start" | "change" | "end", listener: () => void) => void;
};

export type GlobeMethods = {
  pointOfView: (
    view: { lat?: number; lng?: number; altitude?: number },
    transitionMs?: number
  ) => void;
  controls: () => GlobeControls;
};

type GlobeCanvasProps = {
  globeProps: Record<string, unknown>;
  onReady: (globe: GlobeMethods) => void;
};

export default function GlobeCanvas({ globeProps, onReady }: GlobeCanvasProps) {
  const globeRef = useRef<GlobeMethods | null>(null);

  useEffect(() => {
    if (globeRef.current) onReady(globeRef.current);
  }, [onReady]);

  return <Globe ref={globeRef as never} {...globeProps} />;
}
