#!/usr/bin/env python3
"""Generate images from an existing Cala knowledge-search JSON file.

Usage:
    python3 backend/main.py --input data/knowledge-search-spain.json
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPENAI_URL = "https://api.openai.com/v1/responses"
DEFAULT_FAL_MODEL = "fal-ai/flux/schnell"


def load_dotenv(path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) and key not in os.environ:
            os.environ[key] = value


def parse_year(timeline):
    match = re.search(r"(?<!\d)(\d{1,3}(?:[,\.\u202f]\d{3})*|\d{1,4})(?!\d)", timeline)
    if not match:
        return 10**9
    year = int(re.sub(r"[^0-9]", "", match.group(1)))
    suffix = timeline[match.end() : match.end() + 16]
    if re.match(r"\s*(?:st|nd|rd|th)\b(?:\s+century)?", suffix, re.I):
        year = (year - 1) * 100
    if "bc" in timeline[: match.end() + 24].lower():
        year = -year
    return year


def filename_stem(timeline):
    timeline = timeline.replace("–", "-").replace("—", "-")
    ascii_name = unicodedata.normalize("NFKD", timeline).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "-", ascii_name).strip("-") or "undated"


def build_openai_prompt(result):
    return (
        "Create one concise prompt for an image-generation model. Use only the historical source material "
        "below and do not invent facts. Create a historically respectful editorial illustration using "
        "architecture, landscapes, maps, objects, textiles, or ships rather than identifiable real people. "
        "Use painterly detail, cinematic light, a restrained palette, parchment texture, no text, no labels, "
        "and no watermark. Return only the image prompt.\n\n"
        f"Source title: {result.get('title', '')}\n"
        f"Period: {result.get('timeline', '')}\n"
        f"Historical fact: {result.get('fact', '')}"
    )


# Public helper names retained for the pipeline tests and callers.
build_openai_input = build_openai_prompt


def response_text(payload):
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"].strip()
    raise RuntimeError("OpenAI response did not contain text")


extract_response_text = response_text


def topic_slug(query):
    match = re.search(r"\b(?:of|for)\s+([A-Za-z][A-Za-z-]*)\s*$", query.strip(), re.I)
    value = match.group(1) if match else query.split()[-1]
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "results"


def prepare_results(results):
    dated, undated = [], []
    for result in results:
        if result.get("timeline", "").strip():
            dated.append(result)
        else:
            result["timeline"] = "undated"
            undated.append(result)
    return sorted(dated, key=lambda item: parse_year(item["timeline"])) + undated


def call_openai(prompt, api_key, model):
    body = json.dumps({
        "model": model,
        "store": False,
        "instructions": "You are a careful historical art director.",
        "input": prompt,
    }).encode("utf-8")
    request = urllib.request.Request(
        OPENAI_URL,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response_text(json.loads(response.read().decode("utf-8")))


def call_fal(prompt, api_key, model):
    body = json.dumps({
        "prompt": prompt,
        "image_size": "landscape_16_9",
        "num_inference_steps": 4,
        "num_images": 1,
        "enable_safety_checker": True,
        "output_format": "jpeg",
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://fal.run/{model}",
        data=body,
        headers={"Authorization": f"Key {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    try:
        url = payload["images"][0]["url"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("Fal response did not contain an image URL")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("Fal returned an invalid image URL")
    return url


def download(url, destination):
    temporary = destination.with_suffix(".tmp")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            temporary.write_bytes(response.read())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/knowledge-search-spain.json"))
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--openai-model", default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    parser.add_argument("--fal-model", default=os.environ.get("FAL_MODEL", DEFAULT_FAL_MODEL))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env")
    openai_key = os.environ.get("OPENAI_API_KEY")
    fal_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    input_path = args.input if args.input.is_absolute() else PROJECT_ROOT / args.input
    document = json.loads(input_path.read_text(encoding="utf-8"))
    query = document.get("query", "Spain")
    results = list(document.get("results", []))
    if not isinstance(results, list) or not results:
        raise ValueError("Input JSON must contain a non-empty results array")
    results.sort(key=lambda result: parse_year(result.get("timeline", "")))
    slug = topic_slug(query)
    output_dir = args.output_dir or PROJECT_ROOT / "data" / "photos" / slug
    if not output_dir.is_absolute():
        output_dir = PROJECT_ROOT / output_dir
    if not args.dry_run and (not openai_key or not fal_key):
        raise RuntimeError("Missing OPENAI_API_KEY or FAL_KEY/FAL_API_KEY")

    used = set()
    for index, result in enumerate(results, 1):
        stem = filename_stem(result.get("timeline", ""))
        candidate = stem
        suffix = 2
        while candidate in used:
            candidate = f"{stem}-{suffix}"
            suffix += 1
        used.add(candidate)
        output_path = output_dir / f"{index:02d}_{candidate}.jpg"
        if output_path.exists() and not args.force:
            result["image_file"] = str(output_path)
            print(f"{index:02d}. {result.get('title', '')} -> {output_path} (exists; skipping)")
            continue
        prompt = (
            "Create an illustrated historical scene. "
            f"Period: {result.get('timeline', 'undated')}. Fact: {result.get('fact', '')}"
            if args.dry_run
            else call_openai(build_openai_prompt(result), openai_key, args.openai_model)
        )
        result["image_prompt"] = prompt
        result["image_file"] = str(output_path)
        print(f"{index:02d}. {result.get('title', '')} -> {output_path}")
        if args.dry_run or (output_path.exists() and not args.force):
            continue
        output_dir.mkdir(parents=True, exist_ok=True)
        download(call_fal(prompt, fal_key, args.fal_model), output_path)
        input_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    input_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved prompts and filenames to {input_path}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
