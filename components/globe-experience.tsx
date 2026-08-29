"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import worldFeatures from "@/data/world-features.json";

type GlobeMethods = {
  pointOfView: (
    view: { lat?: number; lng?: number; altitude?: number },
    transitionMs?: number
  ) => void;
  controls: () => {
    autoRotate?: boolean;
    autoRotateSpeed?: number;
  };
};

type CountryFeature = {
  properties: {
    name: string;
    iso_a3: string;
  };
};

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false
});

export function GlobeExperience() {
  const router = useRouter();
  const globeRef = useRef<GlobeMethods | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    function syncViewport() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight
      });
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);

    return () => {
      window.removeEventListener("resize", syncViewport);
    };
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) {
      return;
    }

    globe.pointOfView({ lat: 40, lng: -3, altitude: 2.1 }, 0);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
  }, []);

  function beginStoryTransition(target: CountryFeature) {
    if (target.properties.iso_a3 !== "ESP" || isTransitioning) {
      return;
    }

    setIsTransitioning(true);

    const globe = globeRef.current;
    if (globe) {
      const controls = globe.controls();
      controls.autoRotate = false;
      globe.pointOfView({ lat: 40.4, lng: -3.7, altitude: 0.8 }, 1800);
    }

    window.setTimeout(() => {
      router.push("/story/esp");
    }, 2100);
  }

  function handleInteraction() {
    const controls = globeRef.current?.controls();
    if (controls?.autoRotate) {
      controls.autoRotate = false;
    }
  }

  return (
    <main className="relative h-screen overflow-hidden bg-hero-radial">
      <div
        className={`absolute inset-0 transition-opacity duration-[1800ms] ${
          isTransitioning ? "opacity-0" : "opacity-100"
        }`}
      >
        <Globe
          ref={globeRef as never}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          backgroundColor="rgba(0,0,0,0)"
          polygonsData={worldFeatures as CountryFeature[]}
          polygonAltitude={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 === "ESP" ? 0.12 : 0.03
          }
          polygonCapColor={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 === "ESP"
              ? "rgba(212, 177, 106, 0.88)"
              : "rgba(100, 118, 140, 0.12)"
          }
          polygonSideColor={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 === "ESP"
              ? "rgba(212, 177, 106, 0.24)"
              : "rgba(90, 105, 120, 0.06)"
          }
          polygonStrokeColor={() => "rgba(245, 239, 226, 0.35)"}
          polygonsTransitionDuration={300}
          onPolygonClick={(feature: object) =>
            beginStoryTransition(feature as CountryFeature)
          }
          onPolygonHover={handleInteraction}
          onGlobeClick={handleInteraction}
          onZoom={handleInteraction}
          animateIn
          width={viewport.width}
          height={viewport.height}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(5,10,19,0.72)_100%)]" />

      <div className="pointer-events-none absolute left-1/2 top-8 z-10 w-[min(92vw,44rem)] -translate-x-1/2 text-center">
        <p className="font-body text-xs uppercase tracking-[0.4em] text-mist/70">
          Interactive Historical Atlas
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-[0.05em] text-mist sm:text-6xl">
          Spain, 1492 to 1588
        </h1>
        <p className="mt-4 text-sm text-mist/80 sm:text-base">
          Spin the globe and select Spain to enter a six-part visual story.
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 w-[min(92vw,28rem)] -translate-x-1/2 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-center text-sm text-mist/80 backdrop-blur-md">
        Only Spain is active in this MVP. Click the highlighted country to begin.
      </div>
    </main>
  );
}
