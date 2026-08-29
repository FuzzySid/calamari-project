#!/usr/bin/env python3
"""Stage 3: render one ultra-wide panorama per event with Fal, and download it.

Note on aspect ratio: nano-banana-pro rejects the 2:1 a true equirectangular projection
needs (it allows only auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1 and portrait ratios), so the
profile uses 21:9 -- the widest on offer -- and the output is a wide panorama, not a
sphere-wrappable 360 image.

Reads Stage 2's `prompts_image.json`, wraps each prompt in the style profile's projection
guidance and constraints, calls Fal, and writes `images.json` plus the image files.

    python3 backend/stage3_images.py --country Spain
    python3 backend/stage3_images.py --country Spain --only reconquista_1492 --force
    python3 backend/stage3_images.py --country Spain --images-per-event 3
    python3 backend/stage3_images.py --country Spain --dry-run

Requires FAL_KEY or FAL_API_KEY in the repo-root .env (or the environment). Stdlib only.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import (
    PROJECT_ROOT,
    append_run_log,
    country_paths,
    deterministic_seed,
    download,
    load_dotenv,
    project_path,
    read_json,
    request_json,
    require_env,
    utc_now_iso,
    write_json,
)

FAL_URL = "https://fal.run/{model}"
DEFAULT_PROFILE = "backend/styles/wide-panorama-v1.json"


def repo_relative(path):
    """Repo-relative path when possible, else absolute -- a custom --output-root may sit
    outside the repo, and an image already paid for must not be lost to a ValueError."""
    try:
        return str(Path(path).relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


PROMPT_PREFIX = "Build an ultra-wide cinematic panorama image depicting this event"

REQUIRED_PROFILE_KEYS = (
    "version",
    "generation_model",
    "aspect_ratio",
    "resolution",
    "output_format",
    "safety_tolerance",
    "style",
    "projection_guidance",
    "constraints",
)

# Fal serves generated images from short-lived signed URLs, so nothing downstream may
# depend on them; they are recorded only to make a failed run debuggable.
FAL_URL_NOTE = "expired: Fal URLs are short-lived; use local_path"


def load_profile(profile_path):
    """Load the style profile, naming every missing key at once rather than one per run."""
    profile = read_json(profile_path)
    missing = [key for key in REQUIRED_PROFILE_KEYS if key not in profile]
    if missing:
        raise RuntimeError(
            f"Style profile {profile_path} is missing: {', '.join(missing)}"
        )
    return profile


def compose_prompt(prompt_text, profile):
    """Prefix line first, verbatim, then style, projection guidance and constraints.

    The projection guidance is what makes the output actually wrap onto a sphere, so it is
    stated as its own labelled block rather than folded into the style sentence.
    """
    guidance = "\n".join(f"- {item}" for item in profile["projection_guidance"])
    constraints = "\n".join(f"- {item}" for item in profile["constraints"])
    return (
        f"{PROMPT_PREFIX}\n"
        f"{prompt_text.strip()}\n\n"
        f"Style: {profile['style']}.\n\n"
        f"Projection requirements:\n{guidance}\n\n"
        f"Constraints (must all hold):\n{constraints}"
    )


def fal_image_url(model, arguments, api_key, timeout=300):
    """POST to Fal and return the single image URL, rejecting anything malformed."""
    payload = request_json(
        FAL_URL.format(model=model),
        arguments,
        headers={"Authorization": f"Key {api_key}"},
        timeout=timeout,
    )
    try:
        url = payload["images"][0]["url"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError(f"Fal {model} response did not contain an image URL") from error
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError(f"Fal {model} returned an invalid image URL: {url!r}")
    return url


def load_prompts(prompts_path):
    document = read_json(prompts_path)
    prompts = document.get("prompts")
    if not isinstance(prompts, dict) or not prompts:
        raise RuntimeError(f"No prompts found in {prompts_path}")
    return document, prompts


def event_order(info_path, prompts):
    """Number events by their Stage 1 order so filenames match across stages.

    Falls back to the prompts file's own key order when info.json is absent, which keeps
    Stage 3 runnable from a hand-written prompts file.
    """
    ordered = []
    if Path(info_path).is_file():
        try:
            events = read_json(info_path).get("events")
        except (json.JSONDecodeError, OSError):
            events = None
        if isinstance(events, list):
            ordered = [
                event.get("id") for event in events
                if isinstance(event, dict) and event.get("id") in prompts
            ]
    for event_id in prompts:
        if event_id not in ordered:
            ordered.append(event_id)
    return {event_id: index for index, event_id in enumerate(ordered, start=1)}


def image_filename(order, event_id, variant, images_per_event, extension):
    """Variant suffix appears only when more than one image per event was asked for."""
    suffix = "" if images_per_event == 1 else f"-{variant}"
    return f"{order:02d}-{event_id}{suffix}.{extension}"


def existing_images(images_path):
    """Previous manifest entries, so --only never drops the events it did not touch."""
    if not Path(images_path).is_file():
        return {}
    try:
        document = read_json(images_path)
    except (json.JSONDecodeError, OSError):
        return {}
    images = document.get("images")
    return images if isinstance(images, dict) else {}


def merge_entry(manifest, event_id, entry):
    """Replace the matching variant in place; entries are lists so N can grow later."""
    entries = manifest.setdefault(event_id, [])
    for index, existing in enumerate(entries):
        if existing.get("variant") == entry["variant"]:
            entries[index] = entry
            break
    else:
        entries.append(entry)
    entries.sort(key=lambda item: item.get("variant", 0))


def select_prompts(prompts, only):
    if not only:
        return list(prompts)
    if only not in prompts:
        available = ", ".join(prompts)
        raise RuntimeError(
            f"Event id {only!r} is not in the prompts file. Available ids: {available}"
        )
    return [only]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", required=True, help="Country name, e.g. \"Spain\".")
    parser.add_argument("--profile", default=DEFAULT_PROFILE, help="Style profile JSON path.")
    parser.add_argument(
        "--images-per-event", type=int, default=1,
        help="Images to generate per event, each with its own variant seed.",
    )
    parser.add_argument("--only", help="Generate just this event id.")
    parser.add_argument("--force", action="store_true", help="Regenerate images that already exist.")
    parser.add_argument("--output-root", default=None, help="Override the pipeline output root.")
    parser.add_argument("--dry-run", action="store_true", help="Print the prompts; call and write nothing.")
    args = parser.parse_args()

    if args.images_per_event < 1:
        print("Error: --images-per-event must be at least 1.", file=sys.stderr)
        return 1

    load_dotenv()
    paths = country_paths(args.country, args.output_root)
    if not paths["prompts"].is_file():
        print(
            f"Error: no Stage 2 output at {paths['prompts']}.\n"
            f"Run stage 2 for {args.country} first:\n"
            f"  python3 backend/stage2_prompts.py --country {args.country}",
            file=sys.stderr,
        )
        return 1

    profile = load_profile(project_path(args.profile))
    document, prompts = load_prompts(paths["prompts"])
    country_name = document.get("country") or args.country
    selected = select_prompts(prompts, args.only)
    orders = event_order(paths["info"], prompts)
    extension = str(profile["output_format"]).lower()

    # Expand to one job per image up front, so dry-run prints exactly what a real run sends.
    jobs = []
    for event_id in selected:
        for variant in range(1, args.images_per_event + 1):
            order = orders[event_id]
            destination = paths["images_dir"] / image_filename(
                order, event_id, variant, args.images_per_event, extension
            )
            jobs.append({
                "event_id": event_id,
                "order": order,
                "variant": variant,
                "seed": deterministic_seed(paths["slug"], event_id, profile["version"], variant),
                "final_prompt": compose_prompt(prompts[event_id]["prompt"], profile),
                "destination": destination,
            })

    if args.dry_run:
        for index, job in enumerate(jobs, start=1):
            print(f"--- Image {index}/{len(jobs)}: {job['event_id']} (variant {job['variant']}) ---")
            print(f"model: {profile['generation_model']}  seed: {job['seed']}")
            print(f"would write: {job['destination']}")
            print(job["final_prompt"])
            print()
        print(f"Dry run: {len(jobs)} image(s) would be generated.")
        return 0

    api_key = require_env("FAL_KEY", "FAL_API_KEY")

    manifest = existing_images(paths["images"])
    failures = []
    generated = 0
    skipped = 0
    log_events = []

    for index, job in enumerate(jobs, start=1):
        event_id = job["event_id"]
        destination = job["destination"]
        label = f"{index}/{len(jobs)}: {event_id} (variant {job['variant']})"

        if destination.exists() and not args.force:
            print(f"Skipping {label} -- {destination} already exists.", flush=True)
            skipped += 1
            continue

        print(f"Generating {label}...", flush=True)
        try:
            image_url = fal_image_url(
                profile["generation_model"],
                {
                    "prompt": job["final_prompt"],
                    "num_images": 1,
                    "aspect_ratio": profile["aspect_ratio"],
                    "resolution": profile["resolution"],
                    "output_format": profile["output_format"],
                    "seed": job["seed"],
                    "safety_tolerance": profile["safety_tolerance"],
                    "limit_generations": True,
                },
                api_key,
            )
            download(image_url, destination, timeout=300)
        except Exception as error:  # one bad image must not sink the rest of the batch
            print(f"Warning: {event_id} (variant {job['variant']}) failed: {error}",
                  file=sys.stderr, flush=True)
            failures.append((event_id, job["variant"], str(error)))
            continue

        entry = {
            "order": job["order"],
            "variant": job["variant"],
            "seed": job["seed"],
            "final_prompt": job["final_prompt"],
            "local_path": repo_relative(destination),
            "fal_url": FAL_URL_NOTE,
        }
        merge_entry(manifest, event_id, entry)
        log_events.append({"event_id": event_id, **entry})
        generated += 1

    write_json(paths["images"], {
        "country": country_name,
        "country_slug": paths["slug"],
        "generated_at": utc_now_iso(),
        "profile_version": profile["version"],
        "generation_model": profile["generation_model"],
        "aspect_ratio": profile["aspect_ratio"],
        "images": manifest,
    })
    append_run_log(paths["run_log"], {
        "stage": "stage3_images",
        "country": country_name,
        "country_slug": paths["slug"],
        "profile_version": profile["version"],
        "generation_model": profile["generation_model"],
        "aspect_ratio": profile["aspect_ratio"],
        "resolution": profile["resolution"],
        "images_per_event": args.images_per_event,
        "events": log_events,
    })
    print(
        f"Generated {generated} image(s), skipped {skipped}. "
        f"Manifest: {paths['images']}"
    )

    if failures:
        print(f"{len(failures)} image(s) failed:", file=sys.stderr)
        for event_id, variant, error in failures:
            print(f"  {event_id} (variant {variant}): {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
