"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import worldFeatures from "@/data/world-features.json";
import type { GlobeMethods } from "@/components/globe-canvas";
import { japanPeriods } from "@/lib/japan-periods";
import { PeriodSelector } from "@/components/period-selector";
import { spainPeriods, type SpainPeriod } from "@/lib/spain-periods";

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
    ADM0_A3?: string;
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
  code: string;
  size: number;
};

type CountryEntry = {
  feature: CountryFeature;
  code: string;
  name: string;
  center: { lat: number; lng: number };
  rings: GeoCoordinate[][];
  focusAltitude: number;
};

const GlobeCanvas = dynamic(() => import("@/components/globe-canvas"), { ssr: false });
const PeriodFigure = dynamic(() => import("@/components/period-figure"), { ssr: false });
const periodsByCountry: Record<string, SpainPeriod[]> = {
  ESP: spainPeriods,
  JPN: japanPeriods
};
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
  const iso = feature.properties.iso_a3 ?? feature.properties.ISO_A3;
  // Natural Earth marks disputed/complex sovereignty with "-99"; ADM0_A3 stays unique.
  if (!iso || iso === "-99") {
    return feature.properties.ADM0_A3 ?? getCountryName(feature);
  }
  return iso;
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

function getPolygons(feature: CountryFeature) {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as PolygonCoordinates]
    : (feature.geometry.coordinates as MultiPolygonCoordinates);
}

function getLargestRing(feature: CountryFeature) {
  return getPolygons(feature).reduce<GeoCoordinate[]>((largestRing, polygon) => {
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

function getFocusAltitude(rings: GeoCoordinate[][]) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  let crossesAntimeridian = false;

  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  let lngSpan = maxLng - minLng;
  if (lngSpan > 180) {
    // remeasure with longitudes wrapped to [0, 360) for antimeridian countries
    crossesAntimeridian = true;
    let wrappedMin = 360;
    let wrappedMax = 0;
    for (const ring of rings) {
      for (const [, lng] of ring) {
        const wrapped = lng < 0 ? lng + 360 : lng;
        if (wrapped < wrappedMin) wrappedMin = wrapped;
        if (wrapped > wrappedMax) wrappedMax = wrapped;
      }
    }
    lngSpan = Math.min(lngSpan, wrappedMax - wrappedMin);
  }

  const centerLat = (minLat + maxLat) / 2;
  const extent = Math.max(
    maxLat - minLat,
    lngSpan * Math.cos((centerLat * Math.PI) / 180),
    crossesAntimeridian ? 30 : 4
  );

  return Math.min(2.2, Math.max(0.5, 0.45 + extent * 0.03));
}

const countryEntries: CountryEntry[] = countries.map((feature) => {
  const rings = getPolygons(feature)
    .map((polygon) => polygon[0] ?? [])
    .filter((ring) => ring.length >= 3)
    .map((ring) => ring.map(([lng, lat]) => [lat, lng] as GeoCoordinate));

  return {
    feature,
    code: getCountryCode(feature),
    name: getCountryName(feature),
    center: getCountryCenter(feature),
    rings,
    focusAltitude: getFocusAltitude(rings)
  };
});
const entryByFeature = new Map(countryEntries.map((entry) => [entry.feature, entry]));
const entryByCode = new Map(countryEntries.map((entry) => [entry.code, entry]));
const EMPTY_PATHS: GeoCoordinate[][] = [];

const countryLabels: CountryLabel[] = countryEntries.map((entry) => {
  const nameLength = entry.name.length;

  return {
    lat: entry.center.lat,
    lng: entry.center.lng,
    name: entry.name,
    code: entry.code,
    size: nameLength > 18 ? 0.54 : nameLength > 12 ? 0.68 : nameLength > 8 ? 0.8 : 0.92
  };
});

const labelByCode = new Map(countryLabels.map((label) => [label.code, label]));
const EMPTY_LABELS: CountryLabel[] = [];
const entryByNormalizedName = new Map(
  countryEntries.map((entry) => [entry.name.trim().toLowerCase(), entry])
);

const getHoverPathColor = () => "#f5dca0";
const getLabelLat = (label: object) => (label as CountryLabel).lat;
const getLabelLng = (label: object) => (label as CountryLabel).lng;
const getLabelText = (label: object) => (label as CountryLabel).name;

export function GlobeExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const globeRef = useRef<GlobeMethods | null>(null);
  const polygonHoverRef = useRef<string | null>(null);
  const labelHoverRef = useRef<string | null>(null);
  const departingRef = useRef(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [departingMoment, setDepartingMoment] = useState<string | null>(null);
  // The era whose figure is standing on the stage, once one has been summoned.
  const [revealedPeriodId, setRevealedPeriodId] = useState<string | null>(null);
  const [isGlobeReady, setIsGlobeReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const countryParam = searchParams.get("country")?.trim() ?? "";

  const drumHeight = Math.max(390, Math.min(702, viewport.height - 150));
  const activePeriods = selectedCode ? periodsByCountry[selectedCode] : undefined;
  const hasStory = Boolean(activePeriods?.length);

  const hoveredPaths = useMemo(
    () => (hoveredCode ? entryByCode.get(hoveredCode)?.rings ?? EMPTY_PATHS : EMPTY_PATHS),
    [hoveredCode]
  );

  const visibleLabels = useMemo(() => {
    const selected = selectedCode ? labelByCode.get(selectedCode) : undefined;
    const hovered = hoveredCode ? labelByCode.get(hoveredCode) : undefined;
    const labels: CountryLabel[] = [];
    if (selected) labels.push(selected);
    if (hovered && hovered !== selected) labels.push(hovered);
    return labels.length ? labels : EMPTY_LABELS;
  }, [hoveredCode, selectedCode]);

  const getPolygonCapColor = useCallback(
    (feature: object) =>
      entryByFeature.get(feature as CountryFeature)?.code === selectedCode
        ? "rgba(224, 192, 119, 0.68)"
        : "rgba(255, 255, 255, 0.006)",
    [selectedCode]
  );

  const getPolygonStrokeColor = useCallback(
    (feature: object) =>
      entryByFeature.get(feature as CountryFeature)?.code === selectedCode
        ? "rgba(245, 220, 160, 0.95)"
        : "rgba(255, 255, 255, 0.08)",
    [selectedCode]
  );

  const getLabelSize = useCallback(
    (label: object) => {
      const countryLabel = label as CountryLabel;
      return countryLabel.size * (countryLabel.code === selectedCode ? 1.12 : 1);
    },
    [selectedCode]
  );

  const getLabelDotRadius = useCallback(
    (label: object) => ((label as CountryLabel).code === selectedCode ? 0.22 : 0.1),
    [selectedCode]
  );

  const getLabelColor = useCallback(
    (label: object) =>
      (label as CountryLabel).code === selectedCode
        ? "rgba(255, 245, 220, 1)"
        : "rgba(245, 220, 160, 0.92)",
    [selectedCode]
  );

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
    // "start" only fires on user gestures (drag/zoom), never from autoRotate itself.
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });
  }, []);

  const syncHover = useCallback(() => {
    setHoveredCode(labelHoverRef.current ?? polygonHoverRef.current);
  }, []);

  const handlePolygonHover = useCallback(
    (feature: object | null) => {
      polygonHoverRef.current = feature
        ? entryByFeature.get(feature as CountryFeature)?.code ?? null
        : null;
      syncHover();
    },
    [syncHover]
  );

  const handleLabelHover = useCallback(
    (label: object | null) => {
      labelHoverRef.current = label ? (label as CountryLabel).code : null;
      syncHover();
    },
    [syncHover]
  );

  const focusCountry = useCallback((entry: CountryEntry | undefined, syncUrl = true) => {
    if (!entry || departingRef.current) return;

    setSelectedCode(entry.code);
    setRevealedPeriodId(null);
    if (syncUrl) {
      router.replace(`/?country=${encodeURIComponent(entry.name)}`, { scroll: false });
    }
    polygonHoverRef.current = null;
    labelHoverRef.current = null;
    setHoveredCode(null);
    const globe = globeRef.current;
    if (!globe) return;

    globe.controls().autoRotate = false;
    const altitude = entry.focusAltitude;
    globe.pointOfView(
      { lat: entry.center.lat, lng: entry.center.lng - 12 * altitude, altitude },
      1500
    );
  }, [router]);

  const handlePolygonClick = useCallback(
    (feature: object) => focusCountry(entryByFeature.get(feature as CountryFeature)),
    [focusCountry]
  );

  const handleLabelClick = useCallback(
    (label: object) => focusCountry(entryByCode.get((label as CountryLabel).code)),
    [focusCountry]
  );

  const handleGlobeRendered = useCallback(() => setIsGlobeReady(true), []);

  const clearSelection = useCallback((syncUrl = true) => {
    setSelectedCode(null);
    setDepartingMoment(null);
    setRevealedPeriodId(null);
    departingRef.current = false;
    if (syncUrl) {
      router.replace("/", { scroll: false });
    }
    polygonHoverRef.current = null;
    labelHoverRef.current = null;
    setHoveredCode(null);
    const globe = globeRef.current;
    if (!globe) return;

    globe.pointOfView({ lat: 18, lng: 10, altitude: 2.25 }, 1200);
  }, [router]);

  const resetGlobe = useCallback(() => {
    clearSelection(true);
  }, [clearSelection]);

  useEffect(() => {
    if (!isGlobeReady) return;

    if (!countryParam) {
      if (selectedCode) {
        clearSelection(false);
      }
      return;
    }

    const normalizedCountry = countryParam.toLowerCase();
    const matchingEntry =
      entryByNormalizedName.get(normalizedCountry) ?? entryByCode.get(countryParam.toUpperCase());

    if (!matchingEntry) return;
    if (selectedCode === matchingEntry.code) return;

    focusCountry(matchingEntry, false);
  }, [clearSelection, countryParam, focusCountry, isGlobeReady, selectedCode]);

  // Clicking bare globe (ocean, or anywhere while a country is focused) returns
  // to the world view; polygon clicks are handled separately and pick a country.
  const handleGlobeClick = useCallback(() => {
    if (selectedCode && !departingRef.current) resetGlobe();
  }, [resetGlobe, selectedCode]);

  /** Fades the globe out, then hands over to the era's story. */
  function openPeriod(periodId: string, storyId: string) {
    if (!selectedCode || departingRef.current) return;

    departingRef.current = true;
    setDepartingMoment(periodId);
    window.setTimeout(() => {
      router.push(`/story/${selectedCode}/period/${encodeURIComponent(storyId)}`);
    }, 700);
  }

  const globeProps = useMemo(
    () => ({
      globeImageUrl: "//unpkg.com/three-globe/example/img/earth-night.jpg",
      bumpImageUrl: "//unpkg.com/three-globe/example/img/earth-topology.png",
      backgroundColor: "rgba(0,0,0,0)",
      rendererConfig: { antialias: true, powerPreference: "high-performance" },
      polygonsData: countries,
      polygonAltitude: 0.002,
      polygonCapColor: getPolygonCapColor,
      polygonSideColor: "rgba(255, 255, 255, 0.015)",
      polygonStrokeColor: getPolygonStrokeColor,
      polygonsTransitionDuration: 0,
      pathsData: hoveredPaths,
      pathPointAlt: 0.009,
      pathColor: getHoverPathColor,
      pathResolution: 2,
      pathTransitionDuration: 0,
      labelsData: visibleLabels,
      labelsTransitionDuration: 0,
      labelLat: getLabelLat,
      labelLng: getLabelLng,
      labelText: getLabelText,
      labelSize: getLabelSize,
      labelDotRadius: getLabelDotRadius,
      labelAltitude: 0.045,
      labelColor: getLabelColor,
      labelResolution: 3,
      onGlobeClick: handleGlobeClick,
      onPolygonClick: handlePolygonClick,
      onPolygonHover: handlePolygonHover,
      onLabelClick: handleLabelClick,
      onLabelHover: handleLabelHover,
      onGlobeReady: handleGlobeRendered,
      animateIn: true,
      width: viewport.width,
      height: viewport.height
    }),
    [
      getPolygonCapColor,
      getPolygonStrokeColor,
      hoveredPaths,
      visibleLabels,
      handleGlobeClick,
      getLabelSize,
      getLabelDotRadius,
      getLabelColor,
      handlePolygonClick,
      handlePolygonHover,
      handleLabelClick,
      handleLabelHover,
      handleGlobeRendered,
      viewport.width,
      viewport.height
    ]
  );

  return (
    <main className="relative h-screen overflow-hidden bg-hero-radial">
      <div
        className={`absolute inset-0 transition-[transform,opacity] duration-700 ease-[cubic-bezier(.22,.8,.2,1)] motion-reduce:transition-none ${
          hoveredCode ? "[&_canvas]:!cursor-pointer" : "[&_canvas]:!cursor-grab"
        } ${
          departingMoment
            ? "-translate-x-[35vw] opacity-0"
            : revealedPeriodId
              ? "-translate-x-[58vw] scale-[0.94]"
              : selectedCode
                ? "-translate-x-[42vw] scale-[1.06]"
                : "translate-x-0 scale-100"
        }`}
      >
        <GlobeCanvas onReady={handleGlobeReady} globeProps={globeProps} />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_46%,rgba(13,22,38,0.58)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[#0d1626]/80 via-[#0d1626]/30 to-transparent" />
      <p
        className={`pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 translate-y-36 text-[10px] uppercase tracking-[0.3em] text-mist/40 transition-opacity duration-500 ${
          isGlobeReady ? "opacity-0" : "opacity-100"
        }`}
      >
        Loading globe
      </p>
      <div
        className={`pointer-events-none absolute right-0 top-0 z-10 h-full w-full bg-gradient-to-l from-[#0d1626]/92 via-[#0d1626]/45 to-transparent transition-opacity duration-700 md:w-[58%] ${
          selectedCode && !departingMoment ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className={`pointer-events-none absolute left-1/2 top-8 z-10 w-[min(92vw,44rem)] -translate-x-1/2 text-center transition-all duration-500 ${
          selectedCode ? "-translate-y-4 opacity-0" : "opacity-100"
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

      {selectedCode && (
        <div
          className={`pointer-events-none absolute inset-y-0 left-[58%] right-[5%] z-30 hidden flex-col items-center justify-center transition-[opacity,transform] duration-700 ease-[cubic-bezier(.22,.8,.2,1)] motion-reduce:transition-none md:flex ${
            revealedPeriodId && !departingMoment
              ? "translate-y-0 opacity-100"
              : "translate-y-8 opacity-0"
          }`}
        >
          <div
            className={`h-[58vh] w-[min(24vw,21rem)] ${
              revealedPeriodId && !departingMoment ? "pointer-events-auto" : "pointer-events-none"
            }`}
          >
            <PeriodFigure
              className="relative h-full w-full"
              code={selectedCode}
              periodId={revealedPeriodId}
            />
          </div>

          {/* The era names itself in the timeline; only the way in is captioned. */}
          <p className="mt-4 max-w-xs text-center font-mono text-[10px] uppercase tracking-[0.24em] text-gold/55 [text-shadow:0_2px_18px_rgba(0,0,0,.75)]">
            Drag to turn · choose the era again to enter
          </p>
        </div>
      )}

      <aside
        aria-hidden={!selectedCode}
        className={`absolute right-0 top-0 z-20 flex h-full w-full flex-col bg-transparent px-6 py-7 [text-shadow:0_2px_18px_rgba(0,0,0,.75)] transition-[opacity,transform] duration-700 ease-[cubic-bezier(.22,.8,.2,1)] motion-reduce:transition-none sm:px-10 sm:py-9 md:w-[46%] lg:px-14 ${
          selectedCode && !departingMoment
            ? revealedPeriodId
              ? "translate-x-0 opacity-100 md:-translate-x-[24vw]"
              : "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-8 opacity-0"
        }`}
      >
        {selectedCode && (
          <>
            <button
              type="button"
              onClick={resetGlobe}
              className="w-fit rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.22em] text-mist/70 transition hover:border-gold/50 hover:text-mist focus:outline-none focus:ring-2 focus:ring-gold/70"
            >
              ← Back to globe
            </button>

            <div className="flex min-h-0 flex-1 items-center pr-1">
              {hasStory && activePeriods ? (
                <div className="w-full max-w-[36rem]">
                  <PeriodSelector
                    theme="dusk"
                    height={drumHeight}
                    periods={activePeriods}
                    defaultValue={activePeriods[0]?.id}
                    onChange={(period) => setRevealedPeriodId(period.id)}
                    onActivate={(period) => {
                      // First activation summons the era's figure; only once it
                      // is standing does a second one enter the story.
                      if (revealedPeriodId !== period.id) {
                        setRevealedPeriodId(period.id);
                        return;
                      }
                      // Only the eras with a generated story can be entered.
                      const storyId = activePeriods.find((era) => era.id === period.id)?.storyId;
                      if (storyId) openPeriod(period.id, storyId);
                    }}
                  />
                </div>
              ) : (
                <p className="max-w-xs font-mono text-[10px] uppercase leading-5 tracking-[0.24em] text-mist/40">
                  No generated timeline for this country yet.
                </p>
              )}
            </div>
          </>
        )}
      </aside>

      {!selectedCode && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/25 px-5 py-3 text-center text-xs tracking-wide text-mist/65 backdrop-blur-md sm:text-sm">
          {/* Spain contains the complete demo story · Other countries preview the future atlas */}
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-0 z-40 bg-dusk transition-opacity duration-700 ${
          departingMoment ? "opacity-100" : "opacity-0"
        }`}
      />
    </main>
  );
}
