# Calamari Project

Interactive globe MVP for Spain's Age of Exploration and Spanish Golden Age, built with Next.js App Router, TypeScript, Tailwind CSS, and `react-globe.gl`.

## Stack

- Next.js 13 App Router
- TypeScript
- Tailwind CSS
- `react-globe.gl`
- Static JSON in `data/`
- Static image assets in `public/`
- Mocked generation pipeline in `scripts/generate.ts`

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Copy the environment example if you want to prepare for real API wiring later:

```bash
cp .env.local.example .env.local
```

3. Start the development server:

```bash
npm run dev
```

4. Open `http://localhost:3000`

## MVP Flow

- Globe page at `/`
- Spain is the only active country
- Clicking Spain routes to `/story/esp`
- Story page reads from `data/spain.json`
- Six placeholder moments are ready now, so frontend work is decoupled from generation

## Generation Script

Run the mocked build-time generation flow with:

```bash
npm run generate
```

What it does:

- fetches mock historical facts from `lib/cala.ts`
- creates mock narrative copy and image prompts via `lib/openai.ts`
- writes placeholder SVG image assets through `lib/fal.ts`
- overwrites `data/spain.json` with the assembled `Country` object

## Project Structure

```text
app/
  page.tsx
  story/[code]/page.tsx
components/
  globe-experience.tsx
data/
  spain.json
  world-features.json
lib/
  cala.ts
  fal.ts
  openai.ts
scripts/
  generate.ts
types/
  index.ts
public/
  moments/spain/
```

## Notes

- The web app makes no runtime AI calls.
- The Cala, OpenAI, and Fal integrations are intentionally thin mock adapters for now.
- `world-features.json` currently contains Spain only, which keeps the globe interaction working while the rest of the MVP is scaffolded. A fuller world dataset can be dropped in later without changing the page architecture.
