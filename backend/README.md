# Historical story pipeline

`generate_story.py` turns a Cala knowledge-search export into a six-moment, chronological country story. GPT-5 selects and narrates only source-linked events. Fal creates a FLUX.2 Pro image for each event and then sends it through FLUX.2 Pro Edit with the approved museum-editorial anchor.

Keep credentials in the ignored project-root `.env` file or export them:

```sh
OPENAI_API_KEY=... 
FAL_KEY=...
```

Install the Fal CDN uploader once:

```sh
python3 -m pip install -r backend/requirements.txt
```

The anchor is intentionally a review gate. Generate the three variants, inspect them, then promote one:

```sh
python3 -m backend.generate_story --create-anchor-candidates
python3 -m backend.generate_story --select-anchor 2
```

Run the Spain pipeline after anchor approval:

```sh
python3 -m backend.generate_story \
  --input data/knowledge-search-spain.json \
  --country-code ESP \
  --country-name Spain
```

Outputs are `frontend/data/esp.json`, six JPEGs in `frontend/public/moments/esp/`, and one append-only, credential-free run record in `data/fal.json`. The style profile is versioned in `data/styles/museum-editorial-v1.json`.
