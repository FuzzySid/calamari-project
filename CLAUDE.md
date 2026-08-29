# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Turn the Globe" — an interactive 3D globe where clicking a country drops the user into a scroll-driven visual story of that country's most historically dense era, told through verified facts, narrative copy, and illustrated images. Currently scoped to Spain only (era 1492–1588). Built in a hackathon.

The repo is split into two independent halves that share only JSON data contracts:

- **`frontend/`** — the Next.js app (App Router + TypeScript). Everything a user sees.
- **`backend/`** — a standalone Python script that queries Cala's knowledge API directly and writes JSON to `data/`. Unrelated to the frontend's own TypeScript generation pipeline (see below) — kept deliberately separate.
- **`data/`** — output of `backend/knowledge_search.py`, sitting outside both halves.

## Commands

All frontend commands run from `frontend/`:

```bash
cd frontend
npm install
npm run dev      # start dev server (localhost:3000)
npm run build    # production build
npm run start    # run a production build
npm run lint     # next lint
npm run generate # runs scripts/generate.ts — the offline content pipeline (see below)
```

There is no test suite configured in this repo.

Backend script (run from repo root):

```bash
python3 backend/knowledge_search.py "your query here"
```

Reads `CALA_API_KEY` from a `.env` file at the repo root (not `frontend/.env.local`). Writes results to `data/knowledge-search.json` by default; override with `-o <path>`.

## Architecture

### Frontend: zero runtime AI calls, by design

The Next.js app never calls an external AI API at request time. All content — facts, narrative copy, images — is pre-generated offline and committed to the repo as static files. The app only ever reads them:

- `frontend/lib/data.ts` statically **imports** `frontend/data/spain.json` as an ES module (not `fetch`, not `fs.readFile`) and exports `getCountryByCode()`.
- `frontend/app/story/[code]/page.tsx` is a server component that calls `getCountryByCode()` directly at render time and maps over `Country.moments` to render one full-height snap-scroll section per moment.
- `frontend/components/globe-experience.tsx` (`"use client"`) renders the 3D globe (`react-globe.gl`), highlights Spain using `frontend/data/world-features.json`, and on click navigates to `/story/esp` — it does not read `spain.json` itself.

This static-import pattern is the convention for any new page that needs pre-generated data: import the JSON module directly rather than adding a fetch or API route (there is no `app/api/` in this project).

### The offline content pipeline (`frontend/scripts/generate.ts`)

Run manually and offline, never at request time:

```
Cala (facts) → OpenAI (narrative copy + image prompts) → Fal (images)
   → writes frontend/data/spain.json + frontend/public/moments/spain/*.svg
```

Each external API sits behind a thin adapter in `frontend/lib/` (`cala.ts`, `openai.ts`, `fal.ts`), each with a mock implementation (`createMock*Client`) so the pipeline can run end to end without API keys. `generate.ts` currently wires up the mocks, not live clients.

**Content rule enforced by the data model:** `Moment.factText` (from Cala) and `Moment.narrativeCopy` (from OpenAI) are stored as separate fields specifically so narrative copy can never introduce a claim that isn't traceable back to a retrieved fact — see the type in `frontend/types/index.ts`.

### Backend: standalone Cala knowledge-search script

`backend/knowledge_search.py` is unrelated to `generate.ts` / `lib/cala.ts` above — it's a separate, general-purpose script that calls Cala's `knowledge_search` MCP tool over HTTP directly (JSON-RPC, no MCP SDK) for arbitrary natural-language queries, not tied to the Spain era pipeline. For each fact Cala returns, it derives:
- `title` — resolved via Cala's provenance chain (`explainability[i].references` → `context[j].id` → `origins[k].document.name`, falling back to publisher name), never fabricated
- `fact` — the raw claim text
- `description` — a 1–2 sentence summary
- `timeline` — a date/era range extracted via regex from the fact text

If a Cala skill file is present, it documents the full `knowledge_search`/`knowledge_query`/`entity_search`/`entity_retrieval`/`entity_introspection` tool schemas and query language in more depth than this file — consult it before changing how the script talks to Cala.

### Data model (`frontend/types/index.ts`)

```ts
type Moment = {
  id: string;
  year: number;
  orderIndex: number;
  factText: string;        // the verified fact
  sourceRef: string;       // where it came from
  narrativeCopy: string;   // 1–2 sentences, human voice
  imagePath: string;
  imagePrompt: string;     // stored for reproducibility
};

type Country = {
  code: string;            // "ESP"
  name: string;
  eraLabel: string;        // "1492–1588"
  eraStartYear: number;
  eraEndYear: number;
  eraRationale: string;    // why this era was chosen
  moments: Moment[];
};
```

The model is country-agnostic — adding a country is adding another JSON file shaped like `Country`, not a schema change.

### No database

Storage is static JSON + images in `frontend/public/`, committed to the repo. This is a deliberate choice for a single-country MVP, not an oversight — don't introduce a database without confirming the project has actually outgrown this.

## Content rules for anything touching the pipeline

- **Facts come from Cala; copy does not.** The OpenAI step in `generate.ts` may reframe a fact's voice but must never invent a claim beyond what was retrieved.
- **Images are illustrative, not photorealistic** — no generated depictions of real, identifiable historical people, no photorealistic recreations of documented events.
- **Visual consistency across a sequence matters more than any single image** — same art direction, palette, and abstraction level throughout.
- Review every generated image before committing; regenerate rather than debate a questionable one.
