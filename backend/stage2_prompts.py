#!/usr/bin/env python3
"""Stage 2: turn Stage 1's historical events into one image prompt each, via OpenAI.

Reads the events written by Stage 1 (`info.json`) and writes `prompts_image.json`, keyed
by event id -- the join key Stage 3 uses to generate images.

    python3 backend/stage2_prompts.py --country Spain
    python3 backend/stage2_prompts.py --country Spain --only reconquista_1492 --force
    python3 backend/stage2_prompts.py --country Spain --dry-run

Requires OPENAI_API_KEY in the repo-root .env (or the environment). Standard library only.
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import (
    country_paths,
    load_dotenv,
    read_json,
    request_json,
    require_env,
    utc_now_iso,
    write_json,
)

OPENAI_URL = "https://api.openai.com/v1/responses"

INSTRUCTIONS = (
    "You write vivid, historically grounded image-generation prompts. "
    "Return prompt text only, no preamble."
)


def response_output_text(payload):
    """Pull the assistant text out of a Responses API payload.

    The API nests text in output[].content[]; only `output_text` parts are the reply.
    """
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise RuntimeError("OpenAI Responses API did not return output text")


def build_prompt_input(country, event):
    """The user message for one event.

    Deliberately omits any equirectangular/panorama framing -- Stage 3 prefixes its own,
    and duplicating it here would fight that.
    """
    timeline = (event.get("timeline") or {}).get("display") or "date unknown"
    return (
        f"Country: {country}\n"
        f"Period: {timeline}\n"
        f"Event: {event.get('title') or event.get('id')}\n"
        f"Description: {event.get('description') or event.get('event_text') or ''}\n\n"
        "Write a single image-generation prompt for one illustrative historical scene "
        "depicting this event. Ground the setting, architecture, clothing, materials and "
        "light in the stated period and place. Describe the scene, its composition and its "
        "atmosphere concretely. Do not name or portray identifiable real individuals, and "
        "do not include text, captions or labels in the image."
    )


def generate_prompt(country, event, api_key, model):
    """One HTTP call per event, so a single failure costs one prompt rather than the batch."""
    payload = request_json(
        OPENAI_URL,
        {
            "model": model,
            "store": False,
            "instructions": INSTRUCTIONS,
            "input": build_prompt_input(country, event),
        },
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=180,
    )
    text = response_output_text(payload).strip()
    if not text:
        raise RuntimeError("OpenAI returned an empty prompt")
    return text


def load_events(info_path):
    document = read_json(info_path)
    events = document.get("events")
    if not isinstance(events, list) or not events:
        raise RuntimeError(f"No events found in {info_path}")
    return document, events


def existing_prompts(prompts_path):
    """Previous results, so re-runs skip work already paid for. A corrupt file starts over."""
    if not Path(prompts_path).is_file():
        return {}
    try:
        document = read_json(prompts_path)
    except (json.JSONDecodeError, OSError):
        return {}
    prompts = document.get("prompts")
    return prompts if isinstance(prompts, dict) else {}


def select_events(events, only):
    if not only:
        return events
    selected = [event for event in events if event.get("id") == only]
    if not selected:
        available = ", ".join(event.get("id", "?") for event in events)
        raise RuntimeError(f"Event id {only!r} is not in the info file. Available ids: {available}")
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--country", required=True, help="Country name, e.g. \"Spain\".")
    parser.add_argument("--openai-model", default=os.environ.get("OPENAI_MODEL", "gpt-5"))
    parser.add_argument("--only", help="Regenerate just this event id.")
    parser.add_argument("--force", action="store_true", help="Regenerate prompts that already exist.")
    parser.add_argument("--output-root", default=None, help="Override the pipeline output root.")
    parser.add_argument("--dry-run", action="store_true", help="Print the inputs; call and write nothing.")
    args = parser.parse_args()

    load_dotenv()
    paths = country_paths(args.country, args.output_root)
    if not paths["info"].is_file():
        print(
            f"Error: no Stage 1 output at {paths['info']}.\n"
            f"Run stage 1 for {args.country} first.",
            file=sys.stderr,
        )
        return 1

    document, events = load_events(paths["info"])
    country_name = document.get("country") or args.country
    events = select_events(events, args.only)

    prompts = existing_prompts(paths["prompts"])
    pending = [
        event for event in events
        if args.force or event.get("id") not in prompts
    ]
    skipped = len(events) - len(pending)

    if args.dry_run:
        for index, event in enumerate(pending, start=1):
            print(f"--- Prompt {index}/{len(pending)}: {event.get('id')} ---")
            print(f"instructions: {INSTRUCTIONS}")
            print(build_prompt_input(country_name, event))
            print()
        print(f"Dry run: {len(pending)} would be sent, {skipped} already present.")
        return 0

    api_key = require_env("OPENAI_API_KEY")

    failures = []
    for index, event in enumerate(pending, start=1):
        event_id = event.get("id")
        print(f"Prompt {index}/{len(pending)}: {event_id}", flush=True)
        try:
            prompt = generate_prompt(country_name, event, api_key, args.openai_model)
        except Exception as error:  # one bad event must not sink the rest of the batch
            print(f"Warning: {event_id} failed: {error}", file=sys.stderr, flush=True)
            failures.append((event_id, str(error)))
            continue
        prompts[event_id] = {
            "prompt": prompt,
            "source_title": event.get("title", ""),
            "source_description": event.get("description", ""),
            "timeline_display": (event.get("timeline") or {}).get("display", ""),
        }

    write_json(paths["prompts"], {
        "country": country_name,
        "country_slug": paths["slug"],
        "model": args.openai_model,
        "generated_at": utc_now_iso(),
        "prompts": prompts,
    })
    print(f"Wrote {len(prompts)} prompts to {paths['prompts']} ({skipped} skipped).")

    if failures:
        print(f"{len(failures)} event(s) failed:", file=sys.stderr)
        for event_id, error in failures:
            print(f"  {event_id}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
