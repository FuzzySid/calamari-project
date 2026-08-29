"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
    name?: string;
    iso_a3?: string;
    NAME?: string;
    ADMIN?: string;
    ISO_A3?: string;
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
  size: number;
};

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false
});

const countries = ((
  "features" in worldFeatures ? worldFeatures.features : worldFeatures
) as unknown) as CountryFeature[];

function getCountryName(feature: CountryFeature) {
  return (
    feature.properties.name ??
    feature.properties.NAME ??
    feature.properties.ADMIN ??
    "Unknown"
  );
}

function getCountryCode(feature: CountryFeature) {
  return feature.properties.iso_a3 ?? feature.properties.ISO_A3 ?? "UNK";
}

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
  const name = getCountryName(feature);
  const iso_a3 = getCountryCode(feature);
  const nameLength = name.length;
  const size =
    nameLength > 18 ? 0.54 : nameLength > 12 ? 0.68 : nameLength > 8 ? 0.8 : 0.92;

  return {
    lat,
    lng,
    name,
    iso_a3,
    size
  };
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

    globe.pointOfView({ lat: 18, lng: 10, altitude: 2.25 }, 0);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.28;
  }, []);

  function beginStoryTransition(target: CountryFeature) {
    if (isTransitioning) {
      return;
    }

    setIsTransitioning(true);

    const globe = globeRef.current;
    if (globe) {
      const controls = globe.controls();
      controls.autoRotate = false;
      const { lat, lng } = getCountryCenter(target);
      globe.pointOfView({ lat, lng, altitude: 0.8 }, 1800);
    }

    window.setTimeout(() => {
      router.push(`/panorama?country=${encodeURIComponent(getCountryName(target))}`);
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
          polygonsData={countries}
          polygonAltitude={0.002}
          polygonCapColor={() => "rgba(255, 255, 255, 0.01)"}
          polygonSideColor={() => "rgba(255, 255, 255, 0.01)"}
          polygonStrokeColor={() => "rgba(255, 255, 255, 0.12)"}
          polygonsTransitionDuration={220}
          labelsData={countryLabels}
          labelLat={(label: object) => (label as CountryLabel).lat}
          labelLng={(label: object) => (label as CountryLabel).lng}
          labelText={(label: object) => (label as CountryLabel).name}
          labelSize={(label: object) => (label as CountryLabel).size}
          labelDotRadius={0.18}
          labelAltitude={0.045}
          labelColor={() => "rgba(255, 255, 255, 0.98)"}
          labelResolution={4}
          onPolygonClick={(feature: object) =>
            beginStoryTransition(feature as CountryFeature)
          }
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
          Drag to rotate the earth, hover a country to inspect it, and click any
          country to open the panorama experience.
        </p>
      </div>

      <Link
        href="/panorama?country=spain"
        className="absolute right-4 top-4 z-20 rounded-full border border-white/15 bg-black/25 px-4 py-2 text-sm text-mist/85 backdrop-blur-md transition hover:bg-black/45 focus:outline-none focus:ring-2 focus:ring-gold/70 sm:right-8 sm:top-8"
      >
        Try 360° viewer
      </Link>

      <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 w-[min(92vw,28rem)] -translate-x-1/2 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-center text-sm text-mist/80 backdrop-blur-md">
        Explore the full globe and click any country to open its panorama view.
      </div>
    </main>
  );
}
