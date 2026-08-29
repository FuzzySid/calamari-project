"""Local FastAPI service that queues country generation and serves the results.

    uvicorn backend.api.app:app --host 127.0.0.1 --port 8000

Bound to localhost by design: this drives a local dev workflow and holds no auth. The API only
queues work; a separate worker process (backend/api/worker.py) runs the pipeline.
"""

import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline_common import PROJECT_ROOT, read_json  # noqa: E402

from .models import CountryResponse, GenerateRequest, JobResponse, MediaResponse  # noqa: E402
from .store import Store, normalize_code  # noqa: E402

OUTPUT_ROOT = PROJECT_ROOT / "backend" / "output"
ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# Names for countries already generated from the CLI, so a seeded directory keeps its proper
# display name and ISO code rather than a slug-derived guess.
KNOWN_COUNTRIES = {"ESP": "Spain", "PRT": "Portugal"}

store = Store()


@asynccontextmanager
async def lifespan(_app):
    """Adopt countries already generated from the CLI so they are never regenerated."""
    store.seed_from_disk(known_names=list(KNOWN_COUNTRIES.values()))
    for code, name in KNOWN_COUNTRIES.items():
        store.register_known_country(code, name)
    yield


app = FastAPI(title="Country generation API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
# Read-only mount so generated images and MP4s are reachable without copying them into the
# frontend's public directory.
app.mount("/media", StaticFiles(directory=str(OUTPUT_ROOT)), name="media")


@app.get("/api/health")
def health():
    return {"status": "ok", "output_root": str(OUTPUT_ROOT)}


@app.get("/api/countries", response_model=list)
def list_countries():
    return [CountryResponse(**_country_fields(c)).model_dump() for c in store.list_countries()]


@app.post("/api/countries/{iso3}/generate", status_code=202)
def generate(iso3: str, request: GenerateRequest):
    if not normalize_code(iso3):
        # Natural Earth uses "-99" for France, Norway and others; reject rather than
        # creating an output directory named after a non-country.
        raise HTTPException(
            status_code=422,
            detail=f"{iso3!r} is not a valid ISO-3166 alpha-3 country code",
        )
    try:
        job, created = store.request_generation(iso3, request.name)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return {"created": created, "job": JobResponse(**job).model_dump()}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = store.read_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"No job {job_id}")
    return JobResponse(**job).model_dump()


@app.get("/api/countries/{iso3}/media", response_model=MediaResponse)
def get_media(iso3: str):
    code = normalize_code(iso3)
    if not code:
        raise HTTPException(status_code=422, detail=f"{iso3!r} is not a valid ISO-3 code")
    entry = store.get_country(code)
    if not entry:
        raise HTTPException(status_code=404, detail=f"No country {code}")

    name = entry["name"]
    paths = store.paths_for(name)
    titles = _event_titles(paths["info"])
    images = _media_items(paths["images"], "images", entry["slug"], titles, "local_path")
    videos = _media_items(paths["dir"] / "videos.json", "videos", entry["slug"], titles, "local_path")

    if images and videos:
        status = "ready"
    elif images:
        status = "images_ready"
    else:
        status = entry.get("status", "unknown")

    return MediaResponse(
        code=code, name=name, slug=entry["slug"], status=status, images=images, videos=videos
    )


def _country_fields(entry):
    return {
        "code": entry.get("code", ""),
        "name": entry.get("name", ""),
        "slug": entry.get("slug", ""),
        "status": entry.get("status", "unknown"),
        "output_dir": entry.get("output_dir"),
        "job_id": entry.get("job_id"),
    }


def _event_titles(info_path):
    """event_id -> (title, timeline) from Stage 1, so media carries readable labels."""
    if not Path(info_path).is_file():
        return {}
    try:
        info = read_json(info_path)
    except (ValueError, json.JSONDecodeError):
        return {}
    titles = {}
    for event in info.get("events") or []:
        timeline = (event.get("timeline") or {}).get("display")
        titles[event.get("id")] = (event.get("title"), timeline)
    return titles


def _media_items(manifest_path, key, slug, titles, path_field):
    """Manifest entries whose file actually exists, as servable /media URLs.

    Existence is checked per entry: stage 3 and 4 write their manifest even when some events
    failed, so a manifest row is not proof the file is there.
    """
    manifest_path = Path(manifest_path)
    if not manifest_path.is_file():
        return []
    try:
        manifest = read_json(manifest_path)
    except (ValueError, json.JSONDecodeError):
        return []

    # Resolve both sides: manifests may hold absolute or repo-relative paths, and on macOS
    # /var and /private/var are the same directory by different names.
    output_root = Path(OUTPUT_ROOT).resolve()

    items = []
    for event_id, entries in (manifest.get(key) or {}).items():
        for entry in entries:
            local = entry.get(path_field)
            if not local:
                continue
            candidate = Path(local)
            absolute = (candidate if candidate.is_absolute() else PROJECT_ROOT / candidate).resolve()
            if not absolute.is_file():
                continue
            try:
                relative = absolute.relative_to(output_root)
            except ValueError:
                # Outside the served root: cannot be reached through /media, so skip it
                # rather than advertise a URL that would 404.
                continue
            title, timeline = titles.get(event_id, (None, None))
            items.append(
                {
                    "event_id": event_id,
                    "order": entry.get("order", 0),
                    "url": f"/media/{relative.as_posix()}",
                    "title": title,
                    "timeline": timeline,
                }
            )
    items.sort(key=lambda item: item["order"])
    return items
