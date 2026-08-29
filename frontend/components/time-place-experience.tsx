"use client";

import Link from "next/link";
import { useState } from "react";
import type { Country, Moment } from "@/types";

type TimePlaceExperienceProps = {
  country: Country;
  moment: Moment;
};

const fallbackPoint = {
  id: "setting",
  label: "The historical setting",
  description: "A focused location layer will be added when the verified geographic dataset is ready.",
  x: 53,
  y: 48
};

export function TimePlaceExperience({ country, moment }: TimePlaceExperienceProps) {
  const mapPoints = moment.mapPoints?.length ? moment.mapPoints : [fallbackPoint];
  const [selectedPointId, setSelectedPointId] = useState(mapPoints[0].id);
  const selectedPoint =
    mapPoints.find((point) => point.id === selectedPointId) ?? mapPoints[0];
  const momentIndex = country.moments.findIndex((item) => item.id === moment.id);
  const previousMoment = country.moments[momentIndex - 1];
  const nextMoment = country.moments[momentIndex + 1];
  const momentTitle = moment.title ?? moment.factText;
  const momentLocation = moment.location ?? country.name;
  const momentDetail = moment.detailCopy ?? moment.narrativeCopy;
  const panoramaHref = `/panorama?country=${encodeURIComponent(country.name)}&place=${encodeURIComponent(
    momentLocation
  )}&period=${encodeURIComponent(`${moment.year} · ${momentTitle}`)}&event=${encodeURIComponent(
    moment.id
  )}`;

  return (
    <main className="detail-enter min-h-screen overflow-hidden bg-[#efe5cf] text-[#1b2430]">
      <header className="border-b border-[#263748]/15 px-5 py-4 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="rounded-full border border-[#263748]/20 px-4 py-2 text-xs uppercase tracking-[0.2em] transition hover:border-[#9a5f36] hover:text-[#773e24] focus:outline-none focus:ring-2 focus:ring-[#9a5f36]"
          >
            ← Return to globe
          </Link>
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-[#263748]/55">
            <span>{country.name}</span>
            <span aria-hidden="true">/</span>
            <span>{country.eraLabel}</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#8a4d2d]">{moment.year}</span>
          </div>
        </div>
      </header>

      <section className="px-5 pb-10 pt-8 sm:px-8 lg:px-12 lg:pb-14 lg:pt-12">
        <div className="mx-auto max-w-[96rem]">
          <div className="grid gap-8 border-b border-[#263748]/15 pb-9 lg:grid-cols-[0.7fr_1.3fr] lg:items-end lg:gap-14">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[#9a5f36]">
                Time · place {String(momentIndex + 1).padStart(2, "0")}
              </p>
              <h1 className="mt-4 font-display text-5xl leading-[0.94] text-[#142231] sm:text-7xl">
                {momentTitle}
              </h1>
            </div>
            <div>
              <p className="font-display text-2xl text-[#8a4d2d]">{momentLocation}</p>
              <p className="mt-4 max-w-3xl text-base leading-7 text-[#263748]/72 sm:text-lg sm:leading-8">
                {momentDetail}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="relative min-h-[34rem] overflow-hidden rounded-[2rem] border border-[#263748]/20 bg-[#d4c092] shadow-[0_28px_70px_rgba(38,55,72,.16)]">
              <div className="absolute inset-0 opacity-75 [background-image:linear-gradient(rgba(75,86,77,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(75,86,77,.08)_1px,transparent_1px)] [background-size:28px_28px]" />
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 900 590"
                aria-label={`Illustrated demo map of ${momentLocation}`}
                role="img"
              >
                <defs>
                  <filter id="roughen">
                    <feTurbulence baseFrequency="0.018" numOctaves="2" seed="7" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" />
                  </filter>
                </defs>
                <path d="M-20 405 C110 340 180 390 285 330 C410 258 505 300 620 220 C725 145 820 180 930 105 L930 620 L-20 620 Z" fill="#82916d" opacity=".75" filter="url(#roughen)" />
                <path d="M-30 515 C155 430 265 505 430 410 C585 320 690 390 940 270" fill="none" stroke="#55788a" strokeWidth="34" opacity=".7" filter="url(#roughen)" />
                <path d="M70 135 C160 70 240 120 320 65 M585 165 C670 85 760 120 850 45" fill="none" stroke="#737a62" strokeWidth="24" strokeLinecap="round" opacity=".5" />
                <path d="M115 465 C220 380 330 400 430 330 C530 260 650 260 785 185" fill="none" stroke="#7a5538" strokeWidth="6" strokeDasharray="13 10" opacity=".78" />
                <g fill="#bda06b" stroke="#70523a" strokeWidth="3" opacity=".9">
                  <path d="M470 210 l60 -34 55 30 -4 72 -112 4z" />
                  <path d="M520 176 v-42 h18 v42 M555 190 v-31 h17 v31" />
                  <path d="M210 300 l42 -27 47 24 -4 55 -86 2z" />
                </g>
              </svg>

              <div className="absolute left-5 top-5 rounded-full border border-[#263748]/15 bg-[#efe5cf]/88 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[#263748]/65 backdrop-blur sm:left-7 sm:top-7">
                Illustrated map · demo layer
              </div>

              {mapPoints.map((point, index) => {
                const active = point.id === selectedPoint.id;
                return (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => setSelectedPointId(point.id)}
                    aria-label={`Explore ${point.label}`}
                    aria-pressed={active}
                    className={`map-pulse absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-sm font-semibold shadow-lg transition focus:outline-none focus:ring-2 focus:ring-[#162938] focus:ring-offset-2 focus:ring-offset-[#d4c092] ${
                      active
                        ? "scale-110 border-[#f4e8cd] bg-[#8a4d2d] text-white"
                        : "border-[#efe5cf] bg-[#1d3949] text-white hover:scale-110"
                    }`}
                    style={{ left: `${point.x}%`, top: `${point.y}%`, animationDelay: `${index * 400}ms` }}
                  >
                    {index + 1}
                  </button>
                );
              })}

              <div className="absolute bottom-5 left-5 right-5 rounded-[1.4rem] border border-white/35 bg-[#f5ead3]/94 p-5 shadow-xl backdrop-blur sm:bottom-7 sm:left-7 sm:right-auto sm:max-w-md">
                <p className="text-xs uppercase tracking-[0.25em] text-[#9a5f36]">Selected place</p>
                <h2 className="mt-2 font-display text-2xl text-[#172837]">{selectedPoint.label}</h2>
                <p className="mt-2 text-sm leading-6 text-[#263748]/70">{selectedPoint.description}</p>
              </div>
            </section>

            <aside className="grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
              <div className="relative min-h-[27rem] overflow-hidden rounded-[2rem] bg-[#152b3d] text-white shadow-[0_28px_70px_rgba(38,55,72,.2)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_25%,rgba(217,184,117,.28),transparent_28%),linear-gradient(145deg,#24475b,#0b1b28_72%)]" />
                <svg className="absolute inset-x-0 top-8 mx-auto h-[72%] w-[88%] opacity-90" viewBox="0 0 360 390" aria-hidden="true">
                  <path d="M180 55 C131 55 103 95 108 145 C111 179 128 204 145 219 L134 251 C93 264 63 293 49 354 L311 354 C297 293 267 264 226 251 L215 219 C232 204 249 179 252 145 C257 95 229 55 180 55Z" fill="#c69d64" />
                  <path d="M111 139 C107 85 135 42 182 42 C230 42 258 83 252 142 C232 122 211 112 180 112 C151 112 129 121 111 139Z" fill="#352c2c" />
                  <path d="M135 251 C150 267 163 277 180 277 C197 277 210 267 225 251 C267 263 298 299 311 354 L49 354 C62 299 93 263 135 251Z" fill="#8b4f38" />
                  <path d="M108 144 C89 132 86 161 102 179 M252 144 C271 132 274 161 258 179" fill="none" stroke="#c69d64" strokeWidth="15" strokeLinecap="round" />
                  <path d="M153 166 Q180 183 207 166 M162 203 Q180 213 198 203" fill="none" stroke="#714d3d" strokeWidth="4" strokeLinecap="round" opacity=".75" />
                  <path d="M75 354 Q180 305 285 354" fill="none" stroke="#d6b978" strokeWidth="5" opacity=".5" />
                </svg>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0b1b28] via-[#0b1b28]/15 to-transparent" />
                <div className="absolute right-5 top-5 rounded-full border border-white/15 bg-black/25 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-white/70 backdrop-blur">
                  Demo visual
                </div>
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                  <p className="text-xs uppercase tracking-[0.28em] text-[#d9b875]">People of the period</p>
                  <h2 className="mt-3 font-display text-3xl">
                    {moment.representative?.label ?? "A witness to the moment"}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/68">
                    {moment.representative?.description ??
                      "Representative-person artwork and reviewed material details will be added during the final visual generation pass."}
                  </p>
                </div>
              </div>

              <div className="rounded-[2rem] border border-[#263748]/15 bg-[#f8efd9] p-6 sm:p-8">
                <p className="text-xs uppercase tracking-[0.28em] text-[#9a5f36]">Verified fact layer</p>
                <p className="mt-4 font-display text-xl leading-8 text-[#172837]">{moment.factText}</p>
                <p className="mt-5 border-t border-[#263748]/12 pt-4 text-xs uppercase tracking-[0.18em] text-[#263748]/50">
                  {moment.sourceRef} · demo source
                </p>
                <Link
                  href={panoramaHref}
                  className="mt-6 flex items-center justify-between rounded-full bg-[#8a4d2d] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#713a22] focus:outline-none focus:ring-2 focus:ring-[#8a4d2d] focus:ring-offset-2 focus:ring-offset-[#f8efd9]"
                >
                  <span>Step into the 360° view</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </aside>
          </div>

          <nav className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[#263748]/15 pt-7" aria-label="Timeline moments">
            {previousMoment ? (
              <Link className="text-sm text-[#263748]/65 transition hover:text-[#8a4d2d]" href={`/story/${country.code}/${previousMoment.id}`}>
                ← {previousMoment.year} · {previousMoment.title ?? previousMoment.factText}
              </Link>
            ) : <span />}
            {nextMoment ? (
              <Link className="ml-auto text-right text-sm text-[#263748]/65 transition hover:text-[#8a4d2d]" href={`/story/${country.code}/${nextMoment.id}`}>
                {nextMoment.year} · {nextMoment.title ?? nextMoment.factText} →
              </Link>
            ) : (
              <Link className="ml-auto text-sm text-[#263748]/65 transition hover:text-[#8a4d2d]" href="/">
                Return to the globe →
              </Link>
            )}
          </nav>
        </div>
      </section>
    </main>
  );
}
