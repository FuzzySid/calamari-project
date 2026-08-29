# Turn the Globe

An interactive 3D globe where you spin the world, click a country, and drop into its single most historically dense era — told through verified facts and generated visuals.

Built in one day at the **{Tech: Europe} x Cala Hackathon**, Barcelona — Visual Storytelling track.

---

## The idea in one paragraph

Every country has one era that made it what it is. For Spain it's 1492–1588; for India, 1900–1950. This project picks that era for each country and turns it into a short, scroll-driven visual story: a handful of moments, each with a verified historical fact, a line of narrative copy, and an illustrated image. The user spins a globe, clicks a country, and lands inside its defining period.

**Current scope: Spain only.** The data model is country-agnostic, so adding more countries is just another JSON file — but we ship one polished country before we add a second.

---

## Why it's built the way it is

**Everything is pre-generated.** The web app makes zero AI API calls at runtime. A standalone script runs offline, hits the APIs, writes a JSON file and downloads images, and commits them. The app only ever reads static files.

This is a deliberate design decision, not a shortcut:
- The demo loads instantly — no spinner in front of judges
- A flaky API at 8pm can't break the demo
- We control and review every image before it ships
- Cost is bounded and known

**The generation pipeline and the web app are fully decoupled.** If the pipeline is broken, frontend work continues. If the frontend is half-built, generation still runs. Nobody is ever blocked on the other person.

---

## Architecture

```
BUILD TIME (scripts/generate.ts — run manually, offline)

  Cala ──────────► verified facts about the era
    │
    ▼
  OpenAI ────────► narrative copy + image prompts
    │              (reframes facts only — never invents new ones)
    ▼
  Fal ───────────► one illustrated image per moment
    │
    ▼
  data/spain.json  +  public/moments/spain/*.jpg   ← committed to the repo


RUNTIME (the Next.js app — zero AI calls)

  Globe (react-globe.gl)
    │  user clicks Spain
    ▼
  Read data/spain.json
    │
    ▼
  Scroll-driven story: 6 moments, each fact + image + copy
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Globe | react-globe.gl (wraps three.js) |
| Storage | Static JSON + images in `/public` — **no database** |
| Facts | Cala |
| Copy & image prompts | OpenAI |
| Images | Fal |
| Deploy | Vercel |
| Security scan | Aikido |

We're not using a database. For one country it's pure setup overhead. If we get past ~3 countries and it starts hurting, we'll move to Supabase then.

---

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in your keys
npm run dev
```

The app runs entirely off committed data, so **you do not need API keys to work on the frontend.** Keys are only needed to run the generation script.

### Running the generation script

```bash
npx tsx scripts/generate.ts
```

This overwrites `data/spain.json` and writes images to `public/moments/spain/`. Review the output before committing — see the content rules below.

---

## Project structure

```
app/
  page.tsx                 globe view
  story/[code]/page.tsx    era story view
lib/
  cala.ts                  adapter — swap mock for real
  openai.ts                adapter
  fal.ts                   adapter
scripts/
  generate.ts              the build-time pipeline
data/
  spain.json               generated content (committed)
public/
  moments/spain/           generated images (committed)
types/
  index.ts                 Country + Moment types
```

Each external API sits behind a thin adapter in `lib/` with a mock implementation. If you're working on the pipeline and don't have a key yet, the mocks let the whole script run end to end.

---

## Data model

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

---

## Content rules (please read before generating anything)

**1. Facts come from Cala. Copy does not.**
The OpenAI step reframes and finds a voice — it must never introduce a fact that wasn't retrieved. `factText` and `narrativeCopy` are stored separately for exactly this reason. If a claim in the copy isn't traceable to a retrieved fact, cut it. One wrong date visibly undermines the entire premise of the piece.

**2. Images are illustrative, not photorealistic.**
No generated depictions of real, identifiable historical people, and no attempts at photorealistic recreations of documented events. Use period architecture, ships, maps, textiles, objects, landscapes, symbolic scenes. This is both an ethical call and the better aesthetic one — an illustrated visual language reads as more crafted and holds together better across a sequence.

**3. Consistency across the sequence matters more than any single image.**
Same art direction, same palette, same level of abstraction throughout. A sequence where image 4 looks like it came from a different project is worse than six merely-good images that clearly belong together.

**4. Review every generated image before committing.**
If something is questionable, cut it and regenerate. Don't debate it.

---

## Scope

### In scope
- Globe: spin, click Spain, transition into the era
- Story: 6 moments, scroll-driven, fact + image + copy
- Era label and rationale shown on entry
- Back to globe
- Live public URL on Vercel

### Explicitly out of scope
- Video generation (too slow, too many failure modes for a one-day build)
- Any database
- Any runtime AI calls
- Multiple countries (until Spain is genuinely finished)
- Auth, sharing, search, country comparison
- Automated era selection — eras are hand-picked, deliberately
- Mobile polish (make it not-broken; don't make it good)

---

## How we're splitting work

The pipeline/frontend seam is the natural split — they share only the JSON contract, so two people can work in parallel without stepping on each other.

- **Pipeline:** `scripts/generate.ts`, `lib/*` adapters, prompt engineering, image review
- **Frontend:** globe, story view, transitions, polish

Whoever's on frontend builds against the placeholder `data/spain.json` from the start. Real data drops in by overwriting that file — no frontend changes needed.

---

## Working agreements

- **The globe→story transition is the thing judges will remember.** Protect time for it.
- **Stop adding scope at 16:30.** Everything after that is polish, deploy, and rehearsal.
- **Fewer, more finished beats more, half-done.** The craft criterion punishes visible gaps far harder than a shorter feature list.
- Don't hand-roll the globe. react-globe.gl exists.
- Commit generated data and images. They're the product, not build artifacts.

---

## Demo (2 min)

1. *"Every country has one era that made it what it is. We built a globe where you can go stand in it."*
2. Spin, click Spain — let the transition land, don't talk over it
3. Walk 3–4 moments; mention the pipeline once, briefly
4. Close: *"Verified data is the whole point — one hallucinated date and the experience falls apart. That's why the facts come from a knowledge layer, not a search."*
