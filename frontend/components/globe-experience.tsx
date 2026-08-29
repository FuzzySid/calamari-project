"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import worldFeatures from "@/data/world-features.json";
import { getCountryByCode } from "@/lib/data";
import type { Moment } from "@/types";
import type { GlobeMethods } from "@/components/globe-canvas";

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

const GlobeCanvas = dynamic(() => import("@/components/globe-canvas"), { ssr: false });
const storyCountry = getCountryByCode("ESP");
const countries = (
  "features" in worldFeatures ? worldFeatures.features : worldFeatures
) as unknown as CountryFeature[];

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

    if (outerRing.length === 0) return largestRing;
    if (largestRing.length === 0) return outerRing;

    return Math.abs(getRingArea(outerRing)) > Math.abs(getRingArea(largestRing))
      ? outerRing
      : largestRing;
  }, []);
}

function getCountryCenter(feature: CountryFeature) {
  const ring = getLargestRing(feature);
  if (ring.length < 3) return { lat: 0, lng: 0 };

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
  return { lng: centroidX / (6 * area), lat: centroidY / (6 * area) };
}

const countryLabels: CountryLabel[] = countries.map((feature) => {
  const { lat, lng } = getCountryCenter(feature);
  const name = getCountryName(feature);
  const nameLength = name.length;

  return {
    lat,
    lng,
    name,
    iso_a3: getCountryCode(feature),
    size: nameLength > 18 ? 0.54 : nameLength > 12 ? 0.68 : nameLength > 8 ? 0.8 : 0.92
  };
});

export function GlobeExperience() {
  const router = useRouter();
  const globeRef = useRef<GlobeMethods | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryFeature | null>(null);
  const [departingMoment, setDepartingMoment] = useState<string | null>(null);
  const [isGlobeReady, setIsGlobeReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });

  const selectedCode = selectedCountry ? getCountryCode(selectedCountry) : null;
  const hasStory = selectedCode === storyCountry?.code;

  useEffect(() => {
    function syncViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  const handleGlobeReady = useCallback((globe: GlobeMethods) => {
    globeRef.current = globe;
    globe.pointOfView({ lat: 18, lng: 10, altitude: 2.25 }, 0);
    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.28;
  }, []);

  function selectCountry(target: CountryFeature) {
    if (departingMoment) return;

    setSelectedCountry(target);
    const globe = globeRef.current;
    if (!globe) return;

    globe.controls().autoRotate = false;
    const { lat, lng } = getCountryCenter(target);
    globe.pointOfView({ lat, lng, altitude: 1.5 }, 1500);
  }

  function resetGlobe() {
    setSelectedCountry(null);
    setDepartingMoment(null);
    const globe = globeRef.current;
    if (!globe) return;

    globe.pointOfView({ lat: 18, lng: 10, altitude: 2.25 }, 1200);
  }

  function openMoment(moment: Moment) {
    if (!storyCountry || departingMoment) return;

    setDepartingMoment(moment.id);
    window.setTimeout(() => {
      router.push(`/story/${storyCountry.code}/${moment.id}`);
    }, 700);
  }

  function stopRotation() {
    const controls = globeRef.current?.controls();
    if (controls?.autoRotate) controls.autoRotate = false;
  }

  return (
    <main className="relative h-screen overflow-hidden bg-hero-radial">
      <div
        className={`absolute inset-0 transition-[transform,opacity] duration-700 ease-[cubic-bezier(.22,.8,.2,1)] motion-reduce:transition-none ${
          departingMoment
            ? "-translate-x-[35vw] opacity-0"
            : selectedCountry
              ? "-translate-x-[18vw] scale-[1.03]"
              : "translate-x-0 scale-100"
        }`}
      >
        <GlobeCanvas
          onReady={handleGlobeReady}
          globeProps={{
            globeImageUrl: "//unpkg.com/three-globe/example/img/earth-night.jpg",
            bumpImageUrl: "//unpkg.com/three-globe/example/img/earth-topology.png",
            backgroundColor: "rgba(0,0,0,0)",
            polygonsData: countries,
            polygonAltitude: (feature: object) =>
              getCountryCode(feature as CountryFeature) === selectedCode ? 0.025 : 0.002,
            polygonCapColor: (feature: object) =>
              getCountryCode(feature as CountryFeature) === selectedCode
                ? "rgba(212, 177, 106, 0.55)"
                : "rgba(255, 255, 255, 0.01)",
            polygonSideColor: () => "rgba(212, 177, 106, 0.16)",
            polygonStrokeColor: () => "rgba(255, 255, 255, 0.14)",
            polygonsTransitionDuration: 500,
            labelsData: countryLabels,
            labelLat: (label: object) => (label as CountryLabel).lat,
            labelLng: (label: object) => (label as CountryLabel).lng,
            labelText: (label: object) => (label as CountryLabel).name,
            labelSize: (label: object) => (label as CountryLabel).size,
            labelDotRadius: 0.18,
            labelAltitude: 0.045,
            labelColor: () => "rgba(255, 255, 255, 0.96)",
            labelResolution: 4,
            onPolygonClick: (feature: object) => selectCountry(feature as CountryFeature),
            onLabelClick: (label: object) => {
              const countryLabel = label as CountryLabel;
              const target = countries.find(
                (feature) => getCountryCode(feature) === countryLabel.iso_a3
              );
              if (target) selectCountry(target);
            },
            onGlobeClick: stopRotation,
            onZoom: stopRotation,
            onGlobeReady: () => setIsGlobeReady(true),
            animateIn: true,
            width: viewport.width,
            height: viewport.height
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_38%,rgba(5,10,19,0.82)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[#050a13]/85 via-[#050a13]/35 to-transparent" />
      <p
        className={`pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 translate-y-36 text-[10px] uppercase tracking-[0.3em] text-mist/40 transition-opacity duration-500 ${
          isGlobeReady ? "opacity-0" : "opacity-100"
        }`}
      >
        Loading globe
      </p>
      <div
        className={`pointer-events-none absolute right-0 top-0 z-10 h-full w-full bg-gradient-to-l from-[#050a13]/70 via-[#050a13]/25 to-transparent transition-opacity duration-700 md:w-[58%] ${
          selectedCountry && !departingMoment ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`pointer-events-none absolute left-1/2 top-8 z-10 w-[min(92vw,44rem)] -translate-x-1/2 text-center transition-all duration-500 ${
          selectedCountry ? "-translate-y-4 opacity-0" : "opacity-100"
        }`}
      >
        <p className="font-body text-xs uppercase tracking-[0.4em] text-gold/80">
          Interactive Historical Atlas
        </p>
        <h1 className="mt-4 font-display text-3xl text-mist sm:text-5xl">
          Every place holds a turning point.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-mist/70 sm:text-base">
          Rotate the world and choose a country to uncover the moments that reshaped it.
        </p>
      </div>

      <aside
        aria-hidden={!selectedCountry}
        className={`absolute right-0 top-0 z-20 flex h-full w-full flex-col bg-transparent px-6 py-7 [text-shadow:0_2px_18px_rgba(0,0,0,.75)] transition-[opacity,transform] duration-700 ease-[cubic-bezier(.22,.8,.2,1)] motion-reduce:transition-none sm:px-10 sm:py-9 md:w-[46%] lg:px-14 ${
          selectedCountry && !departingMoment
            ? "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-8 opacity-0"
        }`}
      >
        {selectedCountry && (
          <>
            <button
              type="button"
              onClick={resetGlobe}
              className="w-fit rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.22em] text-mist/70 transition hover:border-gold/50 hover:text-mist focus:outline-none focus:ring-2 focus:ring-gold/70"
            >
              ← Back to globe
            </button>

            <div className="mt-10 min-h-0 flex-1 overflow-y-auto pr-1">
              <p className="text-xs uppercase tracking-[0.38em] text-gold/75">
                {hasStory ? "A defining era" : "Atlas preview"}
              </p>
              <h2 className="mt-3 font-display text-5xl leading-none text-mist sm:text-6xl">
                {getCountryName(selectedCountry)}
              </h2>

              {hasStory && storyCountry ? (
                <>
                  <div className="mt-5 flex items-center gap-4">
                    <span className="font-display text-2xl text-gold">{storyCountry.eraLabel}</span>
                    <span className="h-px flex-1 bg-gradient-to-r from-gold/50 to-transparent" />
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-mist/65">
                    {storyCountry.eraRationale}
                  </p>

                  <ol className="relative mt-8 space-y-1 border-l border-white/15 pl-6 sm:mt-10 sm:pl-8">
                    {storyCountry.moments.map((moment, index) => (
                      <li
                        key={moment.id}
                        className="timeline-reveal relative"
                        style={{ animationDelay: `${180 + index * 90}ms` }}
                      >
                        <span className="absolute -left-[1.73rem] top-6 h-2.5 w-2.5 rounded-full border border-gold bg-ink shadow-[0_0_18px_rgba(212,177,106,.55)] sm:-left-[2.23rem]" />
                        <button
                          type="button"
                          onClick={() => openMoment(moment)}
                          className="group w-full rounded-2xl px-4 py-3 text-left transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-gold/70 sm:px-5"
                        >
                          <span className="flex items-baseline gap-4">
                            <span className="w-12 shrink-0 font-display text-xl text-gold">{moment.year}</span>
                            <span className="font-display text-lg text-mist transition group-hover:translate-x-1 group-hover:text-white sm:text-xl">
                              {moment.title ?? moment.factText}
                            </span>
                          </span>
                          <span className="mt-1 block pl-16 text-xs leading-5 text-mist/48 sm:text-sm">
                            {moment.location ?? storyCountry.name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <div className="mt-8 max-w-lg rounded-[1.75rem] border border-white/12 bg-white/[0.04] p-6 sm:p-8">
                  <p className="font-display text-2xl text-mist">This story is still being mapped.</p>
                  <p className="mt-4 text-sm leading-7 text-mist/62">
                    Spain is the complete demo journey. Other countries remain visible so the globe communicates the wider atlas without pretending their historical data is ready.
                  </p>
                  <button
                    type="button"
                    onClick={resetGlobe}
                    className="mt-6 rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-[#e4c986] focus:outline-none focus:ring-2 focus:ring-gold/70 focus:ring-offset-2 focus:ring-offset-ink"
                  >
                    Choose another country
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {!selectedCountry && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-center text-xs tracking-wide text-mist/65 backdrop-blur-md sm:text-sm">
          Spain contains the complete demo story · Other countries preview the future atlas
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-0 z-40 bg-ink transition-opacity duration-700 ${
          departingMoment ? "opacity-100" : "opacity-0"
        }`}
      />
    </main>
  );
}
