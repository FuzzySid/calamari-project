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

type GeoCoordinate = [number, number];
type PolygonCoordinates = GeoCoordinate[][];
type MultiPolygonCoordinates = PolygonCoordinates[];

type CountryFeature = {
  properties: {
    name: string;
    iso_a3: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoordinates | MultiPolygonCoordinates;
  };
};

type CountryLabel = {
  lat: number;
  lng: number;
  name: string;
  iso_a3: string;
};

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false
});

const countries = worldFeatures as CountryFeature[];

function getRingArea(ring: GeoCoordinate[]) {
  let area = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}

function getLargestRing(feature: CountryFeature) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as PolygonCoordinates]
      : (feature.geometry.coordinates as MultiPolygonCoordinates);

  return polygons.reduce<GeoCoordinate[]>((largestRing, polygon) => {
    const outerRing = polygon[0] ?? [];

    if (outerRing.length === 0) {
      return largestRing;
    }

    if (largestRing.length === 0) {
      return outerRing;
    }

    return Math.abs(getRingArea(outerRing)) > Math.abs(getRingArea(largestRing))
      ? outerRing
      : largestRing;
  }, []);
}

function getCountryCenter(feature: CountryFeature) {
  const ring = getLargestRing(feature);

  if (ring.length < 3) {
    return { lat: 0, lng: 0 };
  }

  let centroidX = 0;
  let centroidY = 0;
  let areaAccumulator = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const crossProduct = x1 * y2 - x2 * y1;

    areaAccumulator += crossProduct;
    centroidX += (x1 + x2) * crossProduct;
    centroidY += (y1 + y2) * crossProduct;
  }

  if (areaAccumulator === 0) {
    const [lng, lat] = ring[0];
    return { lat, lng };
  }

  const area = areaAccumulator / 2;

  return {
    lng: centroidX / (6 * area),
    lat: centroidY / (6 * area)
  };
}

const countryLabels: CountryLabel[] = countries.map((feature) => {
  const { lat, lng } = getCountryCenter(feature);

  return {
    lat,
    lng,
    name: feature.properties.name,
    iso_a3: feature.properties.iso_a3
  };
});

export function GlobeExperience() {
  const router = useRouter();
  const globeRef = useRef<GlobeMethods | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [hoveredCountry, setHoveredCountry] = useState<CountryFeature | null>(null);
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

    globe.pointOfView({ lat: 18, lng: 10, altitude: 2.25 }, 0);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.28;
  }, []);

  useEffect(() => {
    document.body.style.cursor = hoveredCountry ? "pointer" : "grab";

    return () => {
      document.body.style.cursor = "";
    };
  }, [hoveredCountry]);

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

  function handleCountryHover(feature: object | null) {
    handleInteraction();
    setHoveredCountry((feature as CountryFeature | null) ?? null);
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
          polygonsData={countries}
          polygonAltitude={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 ===
            hoveredCountry?.properties.iso_a3
              ? 0.055
              : 0.008
          }
          polygonCapColor={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 ===
            hoveredCountry?.properties.iso_a3
              ? "rgba(255, 255, 255, 0.18)"
              : "rgba(255, 255, 255, 0.02)"
          }
          polygonSideColor={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 ===
            hoveredCountry?.properties.iso_a3
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(255, 255, 255, 0.015)"
          }
          polygonStrokeColor={(feature: object) =>
            (feature as CountryFeature).properties.iso_a3 ===
            hoveredCountry?.properties.iso_a3
              ? "rgba(255, 255, 255, 0.7)"
              : "rgba(255, 255, 255, 0.16)"
          }
          polygonsTransitionDuration={220}
          labelsData={countryLabels}
          labelLat={(label: object) => (label as CountryLabel).lat}
          labelLng={(label: object) => (label as CountryLabel).lng}
          labelText={(label: object) => (label as CountryLabel).name}
          labelSize={(label: object) =>
            (label as CountryLabel).iso_a3 === hoveredCountry?.properties.iso_a3
              ? 1.15
              : 0.72
          }
          labelDotRadius={0.12}
          labelAltitude={(label: object) =>
            (label as CountryLabel).iso_a3 === hoveredCountry?.properties.iso_a3
              ? 0.03
              : 0.015
          }
          labelColor={(label: object) =>
            (label as CountryLabel).iso_a3 === hoveredCountry?.properties.iso_a3
              ? "rgba(255, 231, 179, 0.95)"
              : "rgba(235, 244, 255, 0.9)"
          }
          labelResolution={2}
          onPolygonClick={(feature: object) =>
            beginStoryTransition(feature as CountryFeature)
          }
          onPolygonHover={handleCountryHover}
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
        <p className="mt-4 text-sm text-mist/80 sm:text-base">
          Drag to rotate the earth, hover a country to inspect it, and click Spain
          to enter the story experience.
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 w-[min(92vw,28rem)] -translate-x-1/2 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-center text-sm text-mist/80 backdrop-blur-md">
        {hoveredCountry
          ? hoveredCountry.properties.iso_a3 === "ESP"
            ? "Spain is story-enabled. Click to begin."
            : hoveredCountry.properties.name
          : "Explore the full globe. Spain is currently the active story destination."}
      </div>
    </main>
  );
}
