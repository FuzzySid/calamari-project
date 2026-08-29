# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Turn the Globe" — an interactive 3D globe where clicking a country drops the user into a scroll-driven visual story of that country's most historically dense era, told through verified facts, narrative copy, and illustrated images. Currently scoped to Spain only (era 1492–1588). Built in a hackathon.

The repo is split into two independent halves that share only JSON data contracts:

- **`frontend/`** — the Next.js app (App Router + TypeScript). Everything a user sees.
- **`backend/`** — a standalone, country-parameterized Python pipeline (Cala → OpenAI → Fal) that gathers facts, prompts, images and videos into `backend/output/<country-slug>/`. Stdlib only. Unrelated to the frontend's own TypeScript generation pipeline (see below) — kept deliberately separate.

The two halves are currently **disconnected**: the backend gathers data but does not write anything the frontend reads. `frontend/data/spain.json` is a committed artifact of the old pipeline and nothing regenerates it.

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

The frontend has no test suite. The backend's tests are stdlib `unittest` (there is no
pytest in this environment):

```bash
python3 -m unittest discover -s tests -q
```

Backend pipeline (run from repo root). Four stages, each re-runnable on its own, all driven
by a single `--country`:

```bash
python3 backend/stage1_facts.py   --country Spain   # Cala   -> output/<slug>/info.json
python3 backend/stage2_prompts.py --country Spain   # OpenAI -> output/<slug>/prompts_image.json
python3 backend/stage3_images.py  --country Spain   # Fal    -> output/<slug>/images.json + images/
python3 backend/stage4_videos.py  --country Spain   # Fal    -> output/<slug>/videos.json + videos/

python3 backend/run_pipeline.py --country Spain [--with-videos]
```

Reads `CALA_API_KEY`, `OPENAI_API_KEY` and `FAL_API_KEY` (or `FAL_KEY`) from a `.env` at the
repo root (not `frontend/.env.local`). Every stage skips work that already exists, so
re-runs are cheap; `--force` overrides, `--dry-run` calls nothing. See `backend/README.md`
for the full contract and known limits.

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

### Backend: the country pipeline

Unrelated to `generate.ts` / `lib/cala.ts` above. Four stages, each writing its own JSON so
any one can be re-run alone, chained by a **stable event id** generated in Stage 1 (e.g.
`spanish_civil_war_1936`). That id is the join key across `info.json`, `prompts_image.json`,
`images.json` and `videos.json`, which is what makes `--only <event_id>` able to regenerate a
single event without disturbing the others.

Per country: **5 events → 5 prompts → 5 images → 5 ten-second MP4s**.

Everything derives from `--country`; no country name, slug or path is hardcoded, so adding a
country is a command rather than a code change. All HTTP is raw `urllib.request` — no SDKs,
no third-party packages. Shared helpers live in `backend/pipeline_common.py`; never redefine
them in a stage.

Provenance rules carried over from the original script: a source `title`/`url` is resolved
through Cala's chain (`explainability[i].references` → `context[j].id` → `origins[k].document`,
falling back to publisher), and a source `date` is emitted **only** when Cala supplies one —
never fabricated.

If a Cala skill file is present, it documents the full `knowledge_search`/`knowledge_query`/`entity_search`/`entity_retrieval`/`entity_introspection` tool schemas and query language in more depth than this file — consult it before changing how the pipeline talks to Cala.

**Known limit worth knowing before you touch Stage 3:** `fal-ai/nano-banana-pro` rejects the
2:1 aspect ratio a true equirectangular projection needs, so the output is a 21:9 ultra-wide
panorama, *not* sphere-wrappable 360. See `backend/README.md`.

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
