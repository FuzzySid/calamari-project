# Country pipeline

Four sequential stages, each writing its own JSON file so any stage can be re-run on its
own. Everything derives from a single `--country` parameter — no country is hardcoded, so
adding one is a command, not a code change.

```
Stage 1  Cala    facts    -> output/<slug>/info.json
Stage 2  OpenAI  prompts  -> output/<slug>/prompts_image.json
Stage 3  Fal     images   -> output/<slug>/images.json  + images/
Stage 4  Fal     videos   -> output/<slug>/videos.json  + videos/
```

Per country: **5 events, 1 image per event, 1 ten-second MP4 per image**.

## Running

```bash
python3 backend/stage1_facts.py   --country Spain
python3 backend/stage2_prompts.py --country Spain
python3 backend/stage3_images.py  --country Spain
python3 backend/stage4_videos.py  --country Spain

# or the whole chain, for one or many countries
python3 backend/run_pipeline.py --country Spain
python3 backend/run_pipeline.py --countries Spain Japan Brazil

# stage 4 is opt-in: it runs for minutes per event and is the costliest stage
python3 backend/run_pipeline.py --country Spain --with-videos
```

Standard library only — no `pip install` needed. Python 3.8+.

## Local API

A FastAPI service queues generation so a UI never blocks on a ~15-minute run. Two processes:

```bash
python3 -m uvicorn backend.api.app:app --host 127.0.0.1 --port 8000
python3 -m backend.api.worker
```

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/countries` | every known country and its status |
| `POST /api/countries/{iso3}/generate` | body `{"name": "Portugal"}`; queues one job, returns `202` |
| `GET /api/jobs/{job_id}` | status, stage and message, for polling |
| `GET /api/countries/{iso3}/media` | images and videos, reported separately |
| `GET /media/<slug>/...` | read-only static mount over `backend/output/` |

```bash
curl -X POST http://127.0.0.1:8000/api/countries/PRT/generate \
  -H 'Content-Type: application/json' -d '{"name":"Portugal"}'
```

**Repeated requests are safe.** A country that is already `ready`, queued or running returns
its existing job rather than starting a second paid run. Only a `failed` country gets a new
job on the next request.

**Countries generated from the CLI are adopted, not regenerated.** On start the API scans
`backend/output/` and marks any country with both images and videos as `ready` — which is why
Spain needs no special case.

`/api/countries/{iso3}/media` reports images and videos independently
(`images_ready` → `ready`), because stage 3 finishes roughly ten minutes before stage 4. A
client can show the stills while the videos are still rendering.

`-99` is rejected with 422: Natural Earth uses it for France, Norway, Kosovo, Northern Cyprus
and Somaliland, and it would otherwise create a `backend/output/-99/` directory.

State lives in `backend/state/` (gitignored) as plain JSON, guarded by a lock file. A job left
`running` by a killed worker is marked `failed` on the next worker start, so it can be retried.

Bound to `127.0.0.1` with CORS for `localhost:3000` only. No auth — local development only.

## Output layout

```
backend/output/<country-slug>/
    info.json           # 5 dated events, each with sources and entities
    prompts_image.json  # one image prompt per event, keyed by event id
    images.json         # manifest: seed, final prompt, local path
    images/             # 01-<event_id>.jpeg ...
    videos.json         # manifest: seed, prompt, source image, local path
    videos/             # 01-<event_id>-10s.mp4 ...
    run_log.json        # append-only Fal run log
```

The **event id** generated in Stage 1 (e.g. `spanish_civil_war_1936`) is the join key
through all three files. That is what lets `--only <event_id>` regenerate one event's
prompt or image without disturbing the other four.

## Environment

Put these in a `.env` at the repo root:

- `CALA_API_KEY` — Stage 1
- `OPENAI_API_KEY` — Stage 2 (`OPENAI_MODEL` optional, defaults to `gpt-5`)
- `FAL_API_KEY` or `FAL_KEY` — Stages 3 and 4 (either spelling works)

Exported shell variables always win over the `.env` file.

## Re-running

Every stage skips work that already exists, so re-running is cheap and resumes rather than
regenerating — Fal calls in particular are never repeated silently.

- `--force` regenerates anyway. Seeds are deterministic (`sha256` of country + event id +
  style version), so a forced re-run reproduces the *same* image rather than a new one.
- `--only <event_id>` limits Stage 2 or 3 to a single event.
- `--dry-run` on Stage 2 and 3 prints exactly what would be sent and calls nothing.

Stage 1 has no `--dry-run`: its Cala call is the one step that cannot be simulated. The
batch runner skips Stage 1 entirely when `info.json` already exists.

## Stage 4 notes

`blackforestlabs/flux-3/image-to-video`, 10s, 720p, no audio. Output is 1440×608
(ratio 2.368), matching the source stills so nothing is squashed or cropped.

The queue API is used rather than the synchronous endpoint: a generation runs ~2 minutes,
far past any single HTTP timeout. Each job is submitted, polled every 5s, then downloaded.
Images are uploaded to Fal's CDN first (initiate + PUT) rather than inlined as base64 data
URIs, which the docs discourage above a few KB — these panoramas are ~1.5–2 MB.

The prompt asks for a locked-off camera and ambient motion only (drifting smoke, rippling
water, stirring cloth), since the goal is to animate the still rather than reinterpret it.
Use `--motion` to add one scene-specific movement.

## Known limits

- **Not true 360.** `fal-ai/nano-banana-pro` rejects the 2:1 aspect ratio an equirectangular
  projection needs — it allows only `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1` and
  portrait ratios. The profile therefore uses `21:9` (3168×1344, ratio 2.357) and the output
  is an ultra-wide panorama, **not** sphere-wrappable. Real 360 would need a second
  image-to-image pass through something like `fal-ai/hunyuan_world`. The same applies to the
  videos: FLUX 3 *does* accept `2:1`, but feeding it 2.357:1 stills would distort them, so
  Stage 4 defaults to `21:9` to match the source. Override with `--aspect-ratio 2:1` if you
  later produce genuinely equirectangular stills.
- **Video seeds are not deterministic.** Unlike the image stage, FLUX 3 assigns its own seed,
  recorded in `videos.json`. A `--force` re-run produces a *different* video.
- **Dates drive selection.** Events Cala returns without a parseable date are dropped, since
  the story is chronological. Date parsing handles year ranges, BC magnitudes (`50,000 BC`)
  and century forms (`8th–15th centuries`), but it is tuned on Western conventions — other
  countries may yield fewer than 5 events. Stage 1 warns loudly when that happens.
- A bare 3-digit count ("130 ships") is shaped exactly like a year and can be misread as one.
  Harmless in practice because real event text also carries a real date, which wins.

## Style profile

`backend/styles/wide-panorama-v1.json` holds the palette, projection guidance and
constraints, and is country-agnostic — one profile serves every country. Override with
`--profile`.

The repo-root `data/` directory is gone: everything in it was output from the previous
pipeline (knowledge-search dumps, `fal.json`, `photos/`) and nothing read it any more. The
style profile was the one live file and now sits here, next to the code that loads it. The
frontend's own `frontend/data/` is unrelated and untouched.
