"use client";

import { useRef, useState } from "react";
import type { Moment } from "@/types";

type TimelineWheelProps = {
  countryName: string;
  moments: Moment[];
  onOpen: (moment: Moment) => void;
};

const ITEM_HEIGHT = 82;

export function TimelineWheel({ countryName, moments, onOpen }: TimelineWheelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollEndTimer = useRef<number | null>(null);

  function scrollToIndex(index: number) {
    const nextIndex = Math.max(0, Math.min(index, moments.length - 1));
    setSelectedIndex(nextIndex);
    scrollRef.current?.scrollTo({ top: nextIndex * ITEM_HEIGHT, behavior: "smooth" });
  }

  function handleScroll() {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const nextIndex = Math.max(
      0,
      Math.min(Math.round(scroller.scrollTop / ITEM_HEIGHT), moments.length - 1)
    );
    setSelectedIndex(nextIndex);

    if (scrollEndTimer.current) window.clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = window.setTimeout(() => {
      scroller.scrollTo({ top: nextIndex * ITEM_HEIGHT, behavior: "smooth" });
    }, 90);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollToIndex(selectedIndex - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollToIndex(selectedIndex + 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(moments[selectedIndex]);
    }
  }

  return (
    <div className="relative mt-7 sm:mt-9">
      <div
        className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-[82px] -translate-y-1/2 border-y border-gold/25"
        aria-hidden="true"
      >
        <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_15px_rgba(212,177,106,.7)]" />
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.24em] text-gold/48">
          Selected
        </span>
      </div>

      <div
        ref={scrollRef}
        role="listbox"
        aria-label={`${countryName} historical timeline`}
        aria-activedescendant={`timeline-${moments[selectedIndex].id}`}
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="timeline-wheel h-[328px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-[123px] pr-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold/55 [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_19%,black_81%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_19%,black_81%,transparent_100%)]"
      >
        {moments.map((moment, index) => {
          const offset = index - selectedIndex;
          const distance = Math.abs(offset);
          const selected = distance === 0;
          const opacity = selected ? 1 : distance === 1 ? 0.5 : distance === 2 ? 0.2 : 0.07;
          const scale = selected ? 1 : distance === 1 ? 0.93 : distance === 2 ? 0.86 : 0.8;
          const rotateX = Math.max(-58, Math.min(58, offset * -18));

          return (
            <button
              key={moment.id}
              id={`timeline-${moment.id}`}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => (selected ? onOpen(moment) : scrollToIndex(index))}
              className="flex h-[82px] w-full snap-center items-center gap-4 px-4 text-left transition-[opacity,transform] duration-300 ease-out focus:outline-none sm:gap-5 sm:px-5"
              style={{
                opacity,
                transform: `perspective(620px) rotateX(${rotateX}deg) scale(${scale})`
              }}
            >
              <span className={`w-14 shrink-0 font-display text-xl transition-colors ${selected ? "text-gold" : "text-mist/65"}`}>
                {moment.year}
              </span>
              <span className="min-w-0">
                <span className={`block truncate font-display text-lg transition-colors sm:text-xl ${selected ? "text-white" : "text-mist/65"}`}>
                  {moment.title ?? moment.factText}
                </span>
                <span className={`mt-1 block truncate text-xs transition-colors sm:text-sm ${selected ? "text-mist/62" : "text-mist/35"}`}>
                  {moment.location ?? countryName}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="pointer-events-none mt-1 text-center text-[9px] uppercase tracking-[0.25em] text-mist/35">
        Scroll to choose · Select again to enter
      </p>
    </div>
  );
}
