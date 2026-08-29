"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Period = {
  id: string;
  name: string;
  /** Human-readable span shown under the name, e.g. "711 — 1492" */
  label: string;
  /** Short figure used as the ghosted background marker, e.g. "711" */
  marker?: string;
  note?: string;
  /** ids of periods that run at the same time as this one */
  concurrentWith?: string[];
};

export type PeriodSelectorProps = {
  periods: Period[];
  /** Controlled selection (period id). Omit for internal state. */
  value?: string;
  defaultValue?: string;
  onChange?: (period: Period, index: number) => void;
  /** Fired when the already-selected period is chosen again (click / Enter). */
  onActivate?: (period: Period, index: number) => void;
  theme?: "paper" | "dusk";
  /** Height of the drum viewport in px. Default 560. */
  height?: number;
  /** 1px margin tie joining periods that run concurrently. Default false. */
  showConcurrency?: boolean;
  /** Note strip under the drum. Default false. */
  showNote?: boolean;
  className?: string;
};

const ROW = 78;
const WHEEL_LOCK_MS = 180;
const DRAG_PX_PER_ROW = 62;

const SERIF = "var(--font-instrument-serif), Georgia, serif";
const MONO = "var(--font-plex-mono), ui-monospace, Menlo, monospace";
const EDGE_FADE =
  "linear-gradient(to bottom, transparent 0%, #000 24%, #000 76%, transparent 100%)";

const THEMES = {
  paper: {
    bg: "#fbf9f5",
    ink: "#101010",
    ghost: "rgba(16,16,16,0.065)",
    dim: "rgba(16,16,16,0.5)",
    rule: "rgba(16,16,16,0.09)",
    accent: "#8c3a2e"
  },
  dusk: {
    bg: "transparent",
    ink: "#f5efe2",
    ghost: "rgba(245,239,226,0.085)",
    dim: "rgba(245,239,226,0.52)",
    rule: "rgba(245,239,226,0.13)",
    accent: "#d4b16a"
  }
} as const;

export function PeriodSelector({
  periods,
  value,
  defaultValue,
  onChange,
  onActivate,
  theme = "paper",
  height = 560,
  showConcurrency = false,
  showNote = false,
  className
}: PeriodSelectorProps) {
  const t = THEMES[theme];
  const [internal, setInternal] = useState(() => defaultValue ?? value ?? periods[0]?.id);
  const selectedId = value ?? internal;
  const index = Math.max(
    0,
    periods.findIndex((period) => period.id === selectedId)
  );
  const current = periods[index];

  const drumRef = useRef<HTMLDivElement | null>(null);
  const wheelLock = useRef(false);
  const drag = useRef<{ y: number; index: number } | null>(null);

  const select = useCallback(
    (next: number) => {
      const clamped = Math.min(periods.length - 1, Math.max(0, next));
      const period = periods[clamped];
      if (!period || period.id === selectedId) return;
      if (value === undefined) setInternal(period.id);
      onChange?.(period, clamped);
    },
    [periods, selectedId, value, onChange]
  );

  const activate = useCallback(() => {
    if (current) onActivate?.(current, index);
  }, [current, index, onActivate]);

  // A React onWheel handler lands on a passive listener, so preventDefault
  // there is refused. Bind natively to keep the page from scrolling.
  useEffect(() => {
    const drum = drumRef.current;
    if (!drum) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      if (wheelLock.current) return;

      select(index + (event.deltaY > 0 ? 1 : -1));
      wheelLock.current = true;
      window.setTimeout(() => {
        wheelLock.current = false;
      }, WHEEL_LOCK_MS);
    }

    drum.addEventListener("wheel", handleWheel, { passive: false });
    return () => drum.removeEventListener("wheel", handleWheel);
  }, [index, select]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      select(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(periods.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  }

  function handlePointerDown(event: React.PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, index };
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    select(drag.current.index + Math.round((drag.current.y - event.clientY) / DRAG_PX_PER_ROW));
  }

  function handlePointerUp() {
    drag.current = null;
  }

  const concurrent = useMemo(
    () => new Set(periods.filter((period) => period.concurrentWith?.length).map((period) => period.id)),
    [periods]
  );

  /** A tie extends upward when the period above it is one of its concurrents. */
  const tiesUp = useMemo(() => {
    const ids = new Set<string>();
    periods.forEach((period, position) => {
      const previous = periods[position - 1];
      if (previous && period.concurrentWith?.includes(previous.id)) ids.add(period.id);
    });
    return ids;
  }, [periods]);

  const tiesDown = useMemo(() => {
    const ids = new Set<string>();
    periods.forEach((period, position) => {
      const next = periods[position + 1];
      if (next && period.concurrentWith?.includes(next.id)) ids.add(period.id);
    });
    return ids;
  }, [periods]);

  return (
    <div className={className} style={{ background: t.bg, width: "100%", userSelect: "none" }}>
      <div
        ref={drumRef}
        role="listbox"
        aria-label="Historical period"
        aria-activedescendant={current ? `period-${current.id}` : undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          height,
          overflow: "hidden",
          cursor: "ns-resize",
          outline: "none",
          touchAction: "none",
          WebkitMaskImage: EDGE_FADE,
          maskImage: EDGE_FADE
        }}
      >
        {current?.marker && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              textAlign: "center",
              font: `400 138px/0.8 ${SERIF}`,
              letterSpacing: "-0.04em",
              color: t.ghost,
              pointerEvents: "none",
              whiteSpace: "nowrap"
            }}
          >
            {current.marker}
          </div>
        )}

        <div
          className="period-drum"
          style={{
            position: "absolute",
            left: 34,
            right: 30,
            top: "50%",
            display: "flex",
            flexDirection: "column",
            transform: `translateY(${-(index * ROW) - ROW / 2}px)`
          }}
        >
          {periods.map((period, position) => {
            const distance = Math.abs(position - index);
            const selected = position === index;

            return (
              <div
                key={period.id}
                id={`period-${period.id}`}
                role="option"
                aria-selected={selected}
                onClick={() => (selected ? activate() : select(position))}
                className="period-row"
                style={{
                  position: "relative",
                  height: ROW,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  cursor: "pointer",
                  opacity: distance === 0 ? 1 : distance === 1 ? 0.32 : 0.13,
                  transform: `scale(${selected ? 1 : 0.86})`,
                  transformOrigin: "left center"
                }}
              >
                {showConcurrency && concurrent.has(period.id) && (
                  <div
                    aria-hidden
                    className="period-tie"
                    style={{
                      position: "absolute",
                      left: -16,
                      width: 1,
                      top: tiesUp.has(period.id) ? -ROW / 2 : 30,
                      bottom: tiesDown.has(period.id) ? -ROW / 2 : 30,
                      background: t.accent,
                      opacity: distance <= 1 ? 0.7 : 0.22
                    }}
                  />
                )}
                <div
                  style={{
                    font: `400 31px/1 ${SERIF}`,
                    letterSpacing: "-0.015em",
                    color: t.ink,
                    whiteSpace: "nowrap"
                  }}
                >
                  {period.name}
                </div>
                <div
                  style={{
                    font: `400 9.5px/1 ${MONO}`,
                    letterSpacing: "0.1em",
                    color: t.dim,
                    paddingBottom: 4,
                    whiteSpace: "nowrap"
                  }}
                >
                  {period.label}
                </div>
              </div>
            );
          })}
        </div>

        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            width: 18,
            height: 1,
            background: t.accent,
            zIndex: 3
          }}
        />
      </div>

      {showNote && current?.note && (
        <div style={{ borderTop: `1px solid ${t.rule}`, margin: "0 34px 0 34px", padding: "14px 0 4px" }}>
          <div style={{ font: `400 11px/1.5 ${MONO}`, letterSpacing: "0.06em", color: t.dim }}>
            {current.note}
          </div>
        </div>
      )}
    </div>
  );
}
