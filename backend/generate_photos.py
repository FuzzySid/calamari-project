#!/usr/bin/env python3
"""Generate one Fal image for every result in data/knowledge-search.json.

The API key is read from FAL_KEY or FAL_API_KEY, with a local .env file used
as a convenience for this build-time script. It is never written to output.

Examples:
    python3 backend/generate_photos.py --dry-run
    python3 backend/generate_photos.py
    python3 backend/generate_photos.py --force --model fal-ai/flux/schnell
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Sequence


DEFAULT_MODEL = "fal-ai/flux/schnell"
MODEL_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._/-]*[a-z0-9]$")
YEAR_PATTERN = re.compile(r"(?<!\d)(\d{1,3}(?:[,.\u202f]\d{3})*|\d{1,4})(?!\d)")


def load_dotenv(path: Path) -> None:
    """Load simple KEY=VALUE entries without overriding shell variables."""
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) and key not in os.environ:
            os.environ[key] = value


def parse_timeline_start(timeline: str) -> int:
    """Return the approximate first year, using negative values for BC."""
    normalized = timeline.replace("–", "-").replace("—", "-")
    match = YEAR_PATTERN.search(normalized)
    if not match:
        raise ValueError(f"Timeline has no parseable year: {timeline!r}")

    number = int(re.sub(r"[^0-9]", "", match.group(1)))
    prefix = normalized[: match.start()].lower()
    suffix = normalized[match.end() :].lower()
    number_suffix = normalized[match.end() : match.end() + 16]
    if re.match(r"\s*(?:st|nd|rd|th)\b(?:\s+century)?", number_suffix, re.IGNORECASE):
        number = (number - 1) * 100
    if "bc" in prefix or "bce" in prefix or "bc" in suffix or "bce" in suffix:
        number = -number
    return number


def sort_results(results: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Sort results chronologically, preserving input order for equal starts."""
    return sorted(results, key=lambda result: parse_timeline_start(result["timeline"]))


def safe_timeline_filename(timeline: str) -> str:
    """Make a readable, filesystem-safe filename stem from a timeline."""
    readable_timeline = timeline.replace("–", "-").replace("—", "-")
    ascii_timeline = unicodedata.normalize("NFKD", readable_timeline).encode("ascii", "ignore").decode("ascii")
    stem = re.sub(r"[^A-Za-z0-9]+", "-", ascii_timeline).strip("-")
    return stem or "undated"


def unique_output_name(timeline: str, used_names: set) -> str:
    """Return a unique JPEG filename stem while retaining the timeline."""
    stem = safe_timeline_filename(timeline)
    candidate = stem
    suffix = 2
    while candidate in used_names:
        candidate = f"{stem}-{suffix}"
        suffix += 1
    used_names.add(candidate)
    return f"{candidate}.jpg"


def build_prompt(result: Dict[str, str]) -> str:
    """Build a historically grounded prompt from one knowledge-search result."""
    fact = result.get("fact", "").strip()
    timeline = result.get("timeline", "").strip()
    if not fact or not timeline:
        raise ValueError("Each result must contain non-empty 'fact' and 'timeline' fields")

    return (
        "Create an illustrated historical scene for the period {timeline}. "
        "Base the scene only on this source fact: {fact} "
        "Show architecture, landscapes, maps, objects, textiles, or ships rather than "
        "identifiable real people. Painterly editorial illustration, restrained gold and "
        "deep-blue palette, parchment texture, cinematic light, historically respectful, "
        "no text, no labels, no watermark."
    ).format(timeline=timeline, fact=fact)


def call_fal(prompt: str, api_key: str, model: str) -> str:
    """Generate an image and return its temporary Fal media URL."""
    if not MODEL_PATTERN.fullmatch(model):
        raise ValueError(f"Invalid Fal model identifier: {model!r}")

    payload = {
        "prompt": prompt,
        "image_size": "landscape_16_9",
        "num_inference_steps": 4,
        "num_images": 1,
        "enable_safety_checker": True,
        "output_format": "jpeg",
    }
    request = urllib.request.Request(
        f"https://fal.run/{model}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Key {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = json.loads(response.read().decode("utf-8"))

    images = body.get("images")
    if not isinstance(images, list) or not images or not isinstance(images[0], dict):
        raise RuntimeError("Fal response did not contain an image")
    image_url = images[0].get("url")
    if not isinstance(image_url, str) or not image_url.startswith("https://"):
        raise RuntimeError("Fal response contained an invalid image URL")
    return image_url


def download_image(image_url: str, output_path: Path) -> None:
    """Download one generated image to a temporary sibling, then rename it."""
    temporary_path = output_path.with_suffix(".tmp")
    try:
        with urllib.request.urlopen(image_url, timeout=120) as response:
            temporary_path.write_bytes(response.read())
        temporary_path.replace(output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_results(input_path: Path) -> List[Dict[str, str]]:
    document = json.loads(input_path.read_text(encoding="utf-8"))
    results = document.get("results")
    if not isinstance(results, list):
        raise ValueError(f"Input JSON must contain a 'results' array: {input_path}")
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/knowledge-search.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/ohotos"))
    parser.add_argument("--prompts-output", type=Path, default=None)
    parser.add_argument("--model", default=os.environ.get("FAL_MODEL", DEFAULT_MODEL))
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling Fal")
    parser.add_argument("--force", action="store_true", help="Regenerate files that already exist")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    input_path = (project_root / args.input).resolve() if not args.input.is_absolute() else args.input
    output_dir = (project_root / args.output_dir).resolve() if not args.output_dir.is_absolute() else args.output_dir
    prompts_output = args.prompts_output or output_dir / "prompts.json"
    if not prompts_output.is_absolute():
        prompts_output = project_root / prompts_output

    load_dotenv(project_root / ".env")
    api_key: Optional[str] = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    results = sort_results(read_results(input_path))
    prompt_records = []
    used_names = set()

    for index, result in enumerate(results, start=1):
        prompt = build_prompt(result)
        filename = unique_output_name(result["timeline"], used_names)
        output_path = output_dir / f"{index:02d}_{filename}"
        prompt_records.append({"order": index, "timeline": result["timeline"], "prompt": prompt, "file": str(output_path)})
        print(f"{index:02d}. {result['timeline']} -> {output_path}")
        if args.dry_run:
            print(f"    {prompt}")
            continue
        if output_path.exists() and not args.force:
            print("    exists; skipping (use --force to regenerate)")
            continue
        if not api_key:
            raise RuntimeError("Missing FAL_KEY or FAL_API_KEY; use --dry-run to preview prompts")
        image_url = call_fal(prompt, api_key, args.model)
        output_dir.mkdir(parents=True, exist_ok=True)
        download_image(image_url, output_path)

    prompts_output.parent.mkdir(parents=True, exist_ok=True)
    prompts_output.write_text(json.dumps(prompt_records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {len(prompt_records)} prompts to {prompts_output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
