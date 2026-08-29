# Historical story pipeline

`generate_story.py` turns a Cala knowledge-search export into a six-moment, chronological country story. GPT-5 selects and narrates only source-linked events. Fal Nano Banana Pro creates one 16:9, 2K museum-editorial JPEG per event, using the shared castle panorama only for composition and visual treatment.

Keep credentials in the ignored project-root `.env` file or export them:

```sh
OPENAI_API_KEY=... 
FAL_KEY=...
```

Run the Spain pipeline after anchor approval:

```sh
python3 -m backend.generate_story \
  --input data/knowledge-search-spain.json \
  --country-code ESP \
  --country-name Spain
```

Outputs are `frontend/data/spain.json`, six JPEGs in `frontend/public/moments/spain/`, and one append-only, credential-free run record in `data/fal.json`. The style profile is versioned in `data/styles/museum-editorial-v1.json`.
