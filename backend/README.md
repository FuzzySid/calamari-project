# Country pipeline

Three sequential stages, each writing its own JSON file so any stage can be re-run on its
own. Everything derives from a single `--country` parameter — no country is hardcoded, so
adding one is a command, not a code change.

```
Stage 1  Cala    facts    -> output/<slug>/info.json
Stage 2  OpenAI  prompts  -> output/<slug>/prompts_image.json
Stage 3  Fal     images   -> output/<slug>/images.json + images/
```

Per country: **5 events, 1 image per event**.

## Running

```bash
python3 backend/stage1_facts.py   --country Spain
python3 backend/stage2_prompts.py --country Spain
python3 backend/stage3_images.py  --country Spain

# or all three, for one or many countries
python3 backend/run_pipeline.py --country Spain
python3 backend/run_pipeline.py --countries Spain Japan Brazil
```

Standard library only — no `pip install` needed. Python 3.8+.

## Output layout

```
backend/output/<country-slug>/
    info.json           # 5 dated events, each with sources and entities
    prompts_image.json  # one image prompt per event, keyed by event id
    images.json         # manifest: seed, final prompt, local path
    images/             # 01-<event_id>.jpeg ...
    run_log.json        # append-only Fal run log
```

The **event id** generated in Stage 1 (e.g. `spanish_civil_war_1936`) is the join key
through all three files. That is what lets `--only <event_id>` regenerate one event's
prompt or image without disturbing the other four.

## Environment

Put these in a `.env` at the repo root:

- `CALA_API_KEY` — Stage 1
- `OPENAI_API_KEY` — Stage 2 (`OPENAI_MODEL` optional, defaults to `gpt-5`)
- `FAL_API_KEY` or `FAL_KEY` — Stage 3 (either spelling works)

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

## Known limits

- **Not true 360.** `fal-ai/nano-banana-pro` rejects the 2:1 aspect ratio an equirectangular
  projection needs — it allows only `auto`, `21:9`, `16:9`, `3:2`, `4:3`, `5:4`, `1:1` and
  portrait ratios. The profile therefore uses `21:9` (3168×1344, ratio 2.357) and the output
  is an ultra-wide panorama, **not** sphere-wrappable. Real 360 would need a second
  image-to-image pass through something like `fal-ai/hunyuan_world`.
- **Dates drive selection.** Events Cala returns without a parseable date are dropped, since
  the story is chronological. Date parsing handles year ranges, BC magnitudes (`50,000 BC`)
  and century forms (`8th–15th centuries`), but it is tuned on Western conventions — other
  countries may yield fewer than 5 events. Stage 1 warns loudly when that happens.
- A bare 3-digit count ("130 ships") is shaped exactly like a year and can be misread as one.
  Harmless in practice because real event text also carries a real date, which wins.

## Style profile

`data/styles/wide-panorama-v1.json` holds the palette, projection guidance and constraints,
and is country-agnostic — one profile serves every country. `museum-editorial-v1.json` is
kept unchanged so older `data/fal.json` runs citing that version stay interpretable.
