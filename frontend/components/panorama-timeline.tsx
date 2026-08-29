"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import spainData from "@/data/spain.json";

type TimelineEntry = {
  id: string;
  imagePath: string;
  year: number;
  fact: string;
  narrative: string;
};

type TimelineData = {
  country: string;
  eraLabel: string;
  eraRationale: string;
  entries: TimelineEntry[];
};

type PanoramaTimelineProps = {
  country: string;
};

type DragMode = "strip" | "rail" | null;

const SAMPLE_IMAGE_PATH = "/panoramas/castle-panorama.jpg";
const SPAIN_PANORAMA_IMAGES = [
  "/panoramas/spain/1.png",
  "/panoramas/spain/2.png",
  "/panoramas/spain/sandbox-fal.png",
  "/panoramas/spain/4.png"
];
const OVERLAP_RATIO = 0.08;
const END_PANEL_RATIO = 0.72;
const MIN_END_PANEL_WIDTH = 320;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const FALLBACK_YEARS = [1492, 1511, 1530, 1549, 1568, 1588];

const SPAIN_TIMELINE: TimelineData = {
  country: spainData.name,
  eraLabel: spainData.eraLabel,
  eraRationale: spainData.eraRationale,
  entries: spainData.moments.slice(0, SPAIN_PANORAMA_IMAGES.length).map((moment, index) => ({
    id: moment.id,
    imagePath: SPAIN_PANORAMA_IMAGES[index],
    year: moment.year,
    fact: moment.factText,
    narrative: moment.narrativeCopy
  }))
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function buildFallbackTimeline(country: string): TimelineData {
  return {
    country,
    eraLabel: "Sample Era",
    eraRationale:
      "This placeholder range exists to support layout and interaction until generated historical content is connected.",
    entries: FALLBACK_YEARS.map((year, index) => ({
      id: `${country}-${year}-${index}`,
      imagePath: SAMPLE_IMAGE_PATH,
      year,
      fact: `Placeholder fact for ${country} in ${year}.`,
      narrative: `This frame will later hold the generated narrative line for ${country}.`
    }))
  };
}

function getTimelineData(country: string) {
  const normalizedCountry = country.trim().toLowerCase();

  if (normalizedCountry === "spain") {
    return SPAIN_TIMELINE;
  }

  return buildFallbackTimeline(country);
}

function getMaskImage(index: number, total: number) {
  const overlapPercent = OVERLAP_RATIO * 100;
  const opaqueRightEdge = 100 - overlapPercent;

  if (index === 0) {
    return `linear-gradient(to right, black 0%, black ${opaqueRightEdge}%, transparent 100%)`;
  }

  if (index === total - 1) {
    return `linear-gradient(to right, transparent 0%, black ${overlapPercent}%, black 100%)`;
  }

  return `linear-gradient(to right, transparent 0%, black ${overlapPercent}%, black ${opaqueRightEdge}%, transparent 100%)`;
}

export function PanoramaTimeline({ country }: PanoramaTimelineProps) {
  const router = useRouter();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const momentumFrameRef = useRef<number | null>(null);
  const captionTimeoutRef = useRef<number | null>(null);
  const dragStateRef = useRef({
    pointerId: -1,
    mode: null as DragMode,
    lastX: 0,
    lastTime: 0,
    velocity: 0
  });
  const [viewportSize, setViewportSize] = useState({
    width: DEFAULT_VIEWPORT_WIDTH,
    height: DEFAULT_VIEWPORT_HEIGHT
  });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [imagesReady, setImagesReady] = useState(false);
  const [activeCaptionIndex, setActiveCaptionIndex] = useState(0);
  const [isCaptionVisible, setIsCaptionVisible] = useState(true);
  const [isDraggingStrip, setIsDraggingStrip] = useState(false);

  const timeline = getTimelineData(country);
  const entryCount = timeline.entries.length;
  const overlapWidth = viewportSize.width * OVERLAP_RATIO;
  const frameAdvance = Math.max(viewportSize.width - overlapWidth, 1);
  const endPanelWidth = Math.max(viewportSize.width * END_PANEL_RATIO, MIN_END_PANEL_WIDTH);
  const maxTimelineScroll = Math.max(frameAdvance * (entryCount - 1), 0);
  const maxScroll = maxTimelineScroll + endPanelWidth;
  const clampedTimelineScroll = Math.min(scrollLeft, maxTimelineScroll);
  const scrollSegment = frameAdvance > 0 ? clampedTimelineScroll / frameAdvance : 0;
  const lowerFrameIndex = Math.min(Math.floor(scrollSegment), entryCount - 1);
  const upperFrameIndex = Math.min(lowerFrameIndex + 1, entryCount - 1);
  const interpolationProgress =
    upperFrameIndex === lowerFrameIndex ? 0 : scrollSegment - lowerFrameIndex;
  const interpolatedYear = Math.round(
    lerp(
      timeline.entries[lowerFrameIndex].year,
      timeline.entries[upperFrameIndex].year,
      interpolationProgress
    )
  );
  const dominantFrameIndex = Math.min(Math.round(scrollSegment), entryCount - 1);
  const progressRatio =
    maxTimelineScroll > 0 ? clampedTimelineScroll / maxTimelineScroll : 0;
  const introOpacity = clamp(
    1 - clampedTimelineScroll / Math.max(viewportSize.width * 0.22, 1),
    0,
    1
  );
  const endStateProgress =
    endPanelWidth > 0
      ? clamp((scrollLeft - maxTimelineScroll) / endPanelWidth, 0, 1)
      : 0;
  const captionEntry = timeline.entries[activeCaptionIndex];

  useEffect(() => {
    function syncViewport() {
      setViewportSize({
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
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    function syncPreference() {
      setPrefersReducedMotion(mediaQuery.matches);
    }

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const activeViewport = viewport;

    function handleScroll() {
      setScrollLeft(activeViewport.scrollLeft);
    }

    handleScroll();
    activeViewport.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      activeViewport.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollLeft = 0;
    setScrollLeft(0);
    setActiveCaptionIndex(0);
    setIsCaptionVisible(true);
    setIsDraggingStrip(false);
  }, [country]);

  useEffect(() => {
    let isCancelled = false;
    const imagePaths = Array.from(new Set(timeline.entries.map((entry) => entry.imagePath)));

    setImagesReady(false);

    Promise.all(
      imagePaths.map(
        (imagePath) =>
          new Promise<void>((resolve) => {
            const image = new window.Image();
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = imagePath;
          })
      )
    ).then(() => {
      if (!isCancelled) {
        setImagesReady(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [timeline.entries]);

  useEffect(() => {
    if (dominantFrameIndex === activeCaptionIndex) {
      return;
    }

    setIsCaptionVisible(false);

    if (captionTimeoutRef.current) {
      window.clearTimeout(captionTimeoutRef.current);
    }

    captionTimeoutRef.current = window.setTimeout(() => {
      setActiveCaptionIndex(dominantFrameIndex);
      setIsCaptionVisible(true);
    }, prefersReducedMotion ? 90 : 220);

    return () => {
      if (captionTimeoutRef.current) {
        window.clearTimeout(captionTimeoutRef.current);
      }
    };
  }, [activeCaptionIndex, dominantFrameIndex, prefersReducedMotion]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const viewport = viewportRef.current;

      if (!viewport) {
        return;
      }

      event.preventDefault();
      stopMomentum();

      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextScrollLeft = clamp(
        viewport.scrollLeft + frameAdvance * direction,
        0,
        maxTimelineScroll
      );

      viewport.scrollTo({
        left: nextScrollLeft,
        behavior: prefersReducedMotion ? "auto" : "smooth"
      });
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [frameAdvance, maxTimelineScroll, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (momentumFrameRef.current) {
        window.cancelAnimationFrame(momentumFrameRef.current);
      }

      if (captionTimeoutRef.current) {
        window.clearTimeout(captionTimeoutRef.current);
      }
    };
  }, []);

  function stopMomentum() {
    if (momentumFrameRef.current) {
      window.cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }

  function scrollToClamped(nextScrollLeft: number) {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.scrollLeft = clamp(nextScrollLeft, 0, maxScroll);
  }

  function startMomentum(initialVelocity: number) {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const activeViewport = viewport;
    stopMomentum();

    let velocity = initialVelocity * (prefersReducedMotion ? 18 : 34);

    function step() {
      const nextScrollLeft = clamp(activeViewport.scrollLeft + velocity, 0, maxScroll);
      const hasHitEdge = nextScrollLeft === 0 || nextScrollLeft === maxScroll;

      activeViewport.scrollLeft = nextScrollLeft;
      velocity *= prefersReducedMotion ? 0.72 : 0.9;

      if (Math.abs(velocity) < 0.35 || hasHitEdge) {
        momentumFrameRef.current = null;
        return;
      }

      momentumFrameRef.current = window.requestAnimationFrame(step);
    }

    momentumFrameRef.current = window.requestAnimationFrame(step);
  }

  function updateRailPosition(clientX: number) {
    const rail = railRef.current;

    if (!rail) {
      return;
    }

    const railBounds = rail.getBoundingClientRect();
    const nextRatio = clamp((clientX - railBounds.left) / railBounds.width, 0, 1);
    scrollToClamped(nextRatio * maxTimelineScroll);
  }

  function handleViewportWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    stopMomentum();

    const nextScrollLeft =
      event.currentTarget.scrollLeft + event.deltaX + event.deltaY;

    scrollToClamped(nextScrollLeft);
  }

  function handleStripPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('[data-panorama-interactive="true"]')) {
      return;
    }

    stopMomentum();
    dragStateRef.current = {
      pointerId: event.pointerId,
      mode: "strip",
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0
    };
    setIsDraggingStrip(true);

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStripPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const dragState = dragStateRef.current;

    if (!viewport || dragState.mode !== "strip" || dragState.pointerId !== event.pointerId) {
      return;
    }

    const currentTime = performance.now();
    const deltaX = event.clientX - dragState.lastX;
    const nextScrollLeft = clamp(viewport.scrollLeft - deltaX, 0, maxScroll);
    const deltaTime = Math.max(currentTime - dragState.lastTime, 1);

    viewport.scrollLeft = nextScrollLeft;
    dragState.velocity = -deltaX / deltaTime;
    dragState.lastX = event.clientX;
    dragState.lastTime = currentTime;
  }

  function handleStripPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (dragState.mode !== "strip" || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current.mode = null;
    setIsDraggingStrip(false);
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!prefersReducedMotion) {
      startMomentum(dragState.velocity);
    }
  }

  function handleRailPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    stopMomentum();
    dragStateRef.current = {
      pointerId: event.pointerId,
      mode: "rail",
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    updateRailPosition(event.clientX);
  }

  function handleRailPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (dragState.mode !== "rail" || dragState.pointerId !== event.pointerId) {
      return;
    }

    updateRailPosition(event.clientX);
  }

  function handleRailPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;

    if (dragState.mode !== "rail" || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current.mode = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleReturn() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  }

  return (
    <main className="relative h-screen overflow-hidden bg-ink text-mist">
      <div
        ref={viewportRef}
        onWheel={handleViewportWheel}
        onPointerDown={handleStripPointerDown}
        onPointerMove={handleStripPointerMove}
        onPointerUp={handleStripPointerUp}
        onPointerCancel={handleStripPointerUp}
        className="no-scrollbar h-full overflow-x-scroll overflow-y-hidden"
        style={{ cursor: isDraggingStrip ? "grabbing" : "grab" }}
      >
        <div
          className="flex h-full"
          style={{
            width: maxScroll + viewportSize.width
          }}
        >
          {timeline.entries.map((entry, index) => {
            const maskImage = getMaskImage(index, entryCount);
            const maskStyles: CSSProperties = {
              WebkitMaskImage: maskImage,
              maskImage
            };

            return (
              <article
                key={entry.id}
                className="relative h-full shrink-0 overflow-hidden"
                style={{
                  width: viewportSize.width,
                  marginLeft: index === 0 ? 0 : -overlapWidth
                }}
              >
                <Image
                  src={entry.imagePath}
                  alt=""
                  fill
                  unoptimized
                  priority={index < 2}
                  sizes="100vw"
                  className="pointer-events-none h-full w-full select-none object-cover object-center"
                  style={maskStyles}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,18,0.08)_0%,rgba(4,10,18,0.18)_100%)]" />
              </article>
            );
          })}

          <section
            className="relative h-full shrink-0"
            style={{ width: endPanelWidth }}
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,10,19,0)_0%,rgba(5,10,19,0.82)_24%,rgba(5,10,19,0.98)_100%)]" />
            <div className="absolute inset-0 flex items-center justify-center px-8">
              <div
                className="max-w-md text-left transition-opacity"
                style={{
                  opacity: endStateProgress,
                  transitionDuration: prefersReducedMotion ? "120ms" : "420ms"
                }}
              >
                <p className="text-xs uppercase tracking-[0.34em] text-gold/80">
                  Era complete
                </p>
                <h2 className="mt-4 font-display text-4xl text-mist">
                  {timeline.country}, {timeline.eraLabel}
                </h2>
                <p className="mt-4 max-w-sm text-base leading-relaxed text-mist/72">
                  You have reached the end of this timeline. Real generated frames can
                  drop into this layout later without changing the interaction model.
                </p>
                <button
                  type="button"
                  onClick={handleReturn}
                  data-panorama-interactive="true"
                  className="mt-8 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm text-mist transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-gold/70"
                >
                  Return
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,18,0.28)_0%,rgba(4,10,18,0.04)_28%,rgba(4,10,18,0.2)_100%)]" />

      <div
        className="pointer-events-none absolute left-6 top-6 z-20 max-w-[26rem] transition-opacity sm:left-8 sm:top-8"
        style={{
          opacity: introOpacity,
          transform: prefersReducedMotion
            ? "none"
            : `translateY(${(1 - introOpacity) * 12}px)`,
          transitionDuration: prefersReducedMotion ? "120ms" : "240ms"
        }}
      >
        <p className="text-xs uppercase tracking-[0.34em] text-gold/80">{timeline.country}</p>
        <h1 className="mt-3 font-display text-4xl leading-none text-mist sm:text-6xl">
          {timeline.eraLabel}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-mist/80 sm:text-base">
          {timeline.eraRationale}
        </p>
      </div>

      <div className="pointer-events-none absolute left-6 top-40 z-20 sm:left-8 sm:top-44">
        <div className="rounded-full border border-white/10 bg-black/24 px-4 py-2 text-sm uppercase tracking-[0.28em] text-mist/90 backdrop-blur-md sm:text-base">
          {interpolatedYear}
        </div>
      </div>

      <div
        className="pointer-events-none absolute bottom-10 left-0 right-0 z-20 flex justify-center px-5 sm:bottom-12"
        style={{
          opacity: clamp(1 - endStateProgress * 1.35, 0, 1)
        }}
      >
        <div
          className="w-full max-w-3xl rounded-2xl bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_0%,rgba(0,0,0,0.48)_100%)] px-5 py-4 text-center backdrop-blur-sm sm:px-7"
          style={{
            opacity: isCaptionVisible ? 1 : 0,
            transitionDuration: prefersReducedMotion ? "100ms" : "320ms"
          }}
        >
          <p className="text-[11px] uppercase tracking-[0.28em] text-gold/75 sm:text-xs">
            {captionEntry.year}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-mist sm:text-base">
            {captionEntry.fact}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-mist/70 sm:text-sm">
            {captionEntry.narrative}
          </p>
        </div>
      </div>

      <div
        ref={railRef}
        onPointerDown={handleRailPointerDown}
        onPointerMove={handleRailPointerMove}
        onPointerUp={handleRailPointerUp}
        onPointerCancel={handleRailPointerUp}
        className="absolute bottom-0 left-0 right-0 z-30 h-10 cursor-ew-resize"
        aria-label="Timeline progress"
      >
        <div className="absolute bottom-0 left-0 right-0 h-px bg-white/22" />

        {timeline.entries.map((entry, index) => {
          const leftOffset =
            maxTimelineScroll > 0 ? (frameAdvance * index) / maxTimelineScroll : 0;

          return (
            <div
              key={`${entry.id}-tick`}
              className="absolute bottom-0 h-3 w-px bg-white/38"
              style={{ left: `${leftOffset * 100}%` }}
            />
          );
        })}

        <div
          className="absolute bottom-0 h-px bg-gold/80"
          style={{ width: `${progressRatio * 100}%` }}
        />
        <div
          className="absolute bottom-0 h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border border-gold/80 bg-ink shadow-[0_0_24px_rgba(212,177,106,0.45)]"
          style={{ left: `${progressRatio * 100}%` }}
        />
      </div>

      {!imagesReady ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-ink/78 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.34em] text-mist/70">
            Loading panorama
          </p>
        </div>
      ) : null}
    </main>
  );
}
