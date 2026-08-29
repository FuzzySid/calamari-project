#!/usr/bin/env python3
"""Stage 4: animate each panorama into a 10-second MP4 with Fal's FLUX 3.

Reads Stage 3's images for a country, uploads each to Fal's CDN, submits an
image-to-video job, polls the queue, and downloads the result as .mp4.

    python3 backend/stage4_videos.py --country Spain
    python3 backend/stage4_videos.py --country Spain --only spanish_armada_1588 --force
    python3 backend/stage4_videos.py --country Spain --motion "banners flutter gently"
    python3 backend/stage4_videos.py --country Spain --dry-run

Aspect ratio defaults to 21:9 to match the stills Stage 3 produces. The source
images are not true equirectangular (nano-banana-pro cannot emit 2:1), so the
prompt asks for a locked-off camera and ambient motion rather than claiming a
360 projection.

Requires FAL_KEY or FAL_API_KEY in the repo-root .env. Stdlib only.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import (
    PROJECT_ROOT,
    append_run_log,
    country_paths,
    download,
    load_dotenv,
    read_json,
    request_json,
    require_env,
    utc_now_iso,
    write_json,
)

MODEL_ID = "blackforestlabs/flux-3/image-to-video"
QUEUE_URL = "https://queue.fal.run"
UPLOAD_INITIATE_URL = "https://rest.alpha.fal.ai/storage/upload/initiate"

DURATION_SECONDS = 10
RESOLUTION = "720p"
ASPECT_RATIO = "21:9"
SAFETY_TOLERANCE = 2

POLL_INTERVAL_SECONDS = 5
POLL_TIMEOUT_SECONDS = 900

CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

BASE_PROMPT = """
Animate this historical panorama. The camera is completely static and locked on a
tripod: no panning, no tilting, no zooming, no rotation, and no parallax.

Preserve the framing, composition, palette and period detail of the supplied image
exactly. Nothing may be added, removed, or restyled.

Only subtle ambient motion: smoke and dust drift slowly, water ripples, cloth and
banners stir in a light breeze, flames flicker, and any people move naturally and
slowly within the scene. Everything else stays perfectly still. The result is slow,
calm and atmospheric.
""".strip()


def content_type_for(path):
    """Fal needs the real MIME type on upload; a wrong one yields an unreadable asset."""
    suffix = Path(path).suffix.lower()
    if suffix not in CONTENT_TYPES:
        raise ValueError(f"Unsupported image type {suffix!r} for {path}")
    return CONTENT_TYPES[suffix]


def upload_to_fal(path, api_key):
    """Upload a local file to Fal's CDN and return its URL.

    Two steps: ask for a signed upload slot, then PUT the bytes to it. Preferred over a
    base64 data URI because these panoramas are ~1.5-2MB, well past the size where
    inlining the file into the request payload is workable.
    """
    path = Path(path)
    initiated = request_json(
        UPLOAD_INITIATE_URL,
        {"file_name": path.name, "content_type": content_type_for(path)},
        headers={"Authorization": f"Key {api_key}"},
        timeout=60,
    )
    request = urllib.request.Request(
        initiated["upload_url"],
        data=path.read_bytes(),
        headers={"Content-Type": content_type_for(path)},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=600):
        pass
    return initiated["file_url"]


def submit_video_job(arguments, api_key):
    """Queue a generation and return its status/response URLs."""
    return request_json(
        f"{QUEUE_URL}/{MODEL_ID}",
        arguments,
        headers={"Authorization": f"Key {api_key}"},
        timeout=120,
    )


def get_json(url, api_key, timeout=120):
    request = urllib.request.Request(url, headers={"Authorization": f"Key {api_key}"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def await_video_url(submission, api_key):
    """Poll the queue until the job completes, then return the video URL.

    Video generation runs for minutes, far past a single HTTP timeout, so the queue API
    is used rather than the synchronous endpoint the image stage can rely on.
    """
    status_url = submission["status_url"]
    response_url = submission["response_url"]
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    last_status = None

    while True:
        status = get_json(status_url, api_key).get("status")
        if status != last_status:
            print(f"    queue status: {status}", flush=True)
            last_status = status
        if status == "COMPLETED":
            break
        if status in {"FAILED", "CANCELLED", "ERROR"}:
            raise RuntimeError(f"Fal job {status.lower()}")
        if time.monotonic() > deadline:
            raise RuntimeError(f"Fal job still {status} after {POLL_TIMEOUT_SECONDS}s")
        time.sleep(POLL_INTERVAL_SECONDS)

    payload = get_json(response_url, api_key, timeout=180)
    try:
        url = payload["video"]["url"]
    except (KeyError, TypeError) as error:
        raise RuntimeError("Fal response did not contain a video URL") from error
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("Fal returned an invalid video URL")
    return url, payload.get("seed")


def build_prompt(scene_motion):
    if not scene_motion:
        return BASE_PROMPT
    return f"{BASE_PROMPT}\n\nScene-specific gentle motion: {scene_motion.strip()}"


def load_jobs(paths, only):
    """One job per Stage 3 image, in event order."""
    if not paths["images"].is_file():
        raise RuntimeError(
            f"No Stage 3 output at {paths['images']}.\nRun stage 3 for this country first."
        )
    manifest = read_json(paths["images"])
    images = manifest.get("images") or {}
    if only:
        if only not in images:
            available = ", ".join(sorted(images)) or "(none)"
            raise RuntimeError(f"Unknown event id {only!r}. Available: {available}")
        images = {only: images[only]}

    jobs = []
    for event_id, entries in images.items():
        for entry in entries:
            source = PROJECT_ROOT / entry["local_path"]
            if not source.is_file():
                print(f"Warning: {event_id}: missing image {source}", file=sys.stderr)
                continue
            jobs.append(
                {
                    "event_id": event_id,
                    "order": entry.get("order", 0),
                    "variant": entry.get("variant", 1),
                    "source": source,
                }
            )
    jobs.sort(key=lambda job: (job["order"], job["variant"]))
    return jobs


def merge_entry(manifest, event_id, entry):
    """Replace the matching variant in place so --only never clobbers other events."""
    entries = manifest["videos"].setdefault(event_id, [])
    for index, existing in enumerate(entries):
        if existing.get("variant") == entry["variant"]:
            entries[index] = entry
            return
    entries.append(entry)
    entries.sort(key=lambda item: item.get("variant", 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--country", required=True, help="Country name, e.g. \"Spain\".")
    parser.add_argument("--only", help="Generate just this event id.")
    parser.add_argument("--motion", default="", help="Optional scene-specific gentle motion.")
    parser.add_argument("--duration", type=int, default=DURATION_SECONDS, help="Seconds (5-20).")
    parser.add_argument("--resolution", default=RESOLUTION, choices=["720p", "1080p"])
    parser.add_argument("--aspect-ratio", default=ASPECT_RATIO,
                        choices=["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"])
    parser.add_argument("--force", action="store_true", help="Regenerate videos that already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Print the plan; call and write nothing.")
    parser.add_argument("--output-root", default=None)
    args = parser.parse_args()

    load_dotenv()
    api_key = None if args.dry_run else require_env("FAL_KEY", "FAL_API_KEY")

    paths = country_paths(args.country, args.output_root)
    videos_dir = paths["dir"] / "videos"
    manifest_path = paths["dir"] / "videos.json"

    jobs = load_jobs(paths, args.only)
    if not jobs:
        print("Nothing to do: no Stage 3 images found.", file=sys.stderr)
        return 1

    manifest = {"videos": {}}
    if manifest_path.is_file():
        existing = read_json(manifest_path)
        if isinstance(existing.get("videos"), dict):
            manifest = existing
    manifest.update({
        "country": args.country,
        "country_slug": paths["slug"],
        "generated_at": utc_now_iso(),
        "model": MODEL_ID,
        "duration_seconds": args.duration,
        "resolution": args.resolution,
        "aspect_ratio": args.aspect_ratio,
    })
    manifest.setdefault("videos", {})

    prompt = build_prompt(args.motion)
    generated, skipped, failures, log_events = 0, 0, [], []

    for index, job in enumerate(jobs, start=1):
        event_id, variant = job["event_id"], job["variant"]
        stem = job["source"].stem
        destination = videos_dir / f"{stem}-{args.duration}s.mp4"
        label = f"{index}/{len(jobs)}: {event_id}"

        if destination.exists() and not args.force and not args.dry_run:
            print(f"Skipping {label} -- {destination.name} already exists.", flush=True)
            skipped += 1
            continue

        if args.dry_run:
            print(f"\n--- {label} ---")
            print(f"source: {job['source']}")
            print(f"would write: {destination}")
            print(f"model: {MODEL_ID}  {args.duration}s  {args.resolution}  {args.aspect_ratio}")
            print(prompt)
            continue

        print(f"Generating {label}...", flush=True)
        try:
            image_url = upload_to_fal(job["source"], api_key)
            submission = submit_video_job(
                {
                    "prompt": prompt,
                    "image_url": image_url,
                    "duration": args.duration,
                    "aspect_ratio": args.aspect_ratio,
                    "resolution": args.resolution,
                    "generate_audio": False,
                    "safety_tolerance": SAFETY_TOLERANCE,
                },
                api_key,
            )
            video_url, seed = await_video_url(submission, api_key)
            download(video_url, destination, timeout=900)
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, OSError, KeyError) as error:
            # One failure must not cost the whole batch: these calls are slow and paid.
            print(f"Warning: {event_id} failed: {error}", file=sys.stderr, flush=True)
            failures.append((event_id, str(error)))
            continue

        entry = {
            "order": job["order"],
            "variant": variant,
            "seed": seed,
            "source_image": str(job["source"].relative_to(PROJECT_ROOT)),
            "local_path": str(destination.relative_to(PROJECT_ROOT)),
            "prompt": prompt,
        }
        merge_entry(manifest, event_id, entry)
        log_events.append({"event_id": event_id, **entry})
        generated += 1

    if args.dry_run:
        print(f"\nDry run: {len(jobs)} video(s) would be generated.")
        return 0

    # Keep the manifest in event order: entries are added as jobs finish, and --only or a
    # retry would otherwise leave the keys in an arbitrary order.
    manifest["videos"] = dict(
        sorted(manifest["videos"].items(), key=lambda item: item[1][0].get("order", 0))
    )
    write_json(manifest_path, manifest)
    if log_events:
        append_run_log(paths["run_log"], {
            "stage": "videos",
            "country": args.country,
            "country_slug": paths["slug"],
            "model": MODEL_ID,
            "duration_seconds": args.duration,
            "resolution": args.resolution,
            "aspect_ratio": args.aspect_ratio,
            "events": log_events,
        })

    if failures:
        print(f"\n{len(failures)} video(s) failed:", file=sys.stderr)
        for event_id, error in failures:
            print(f"  {event_id}: {error}", file=sys.stderr)

    print(f"\nGenerated {generated} video(s), skipped {skipped}. Manifest: {manifest_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
