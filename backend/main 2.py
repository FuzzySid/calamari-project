#!/usr/bin/env python3
"""Run the Cala -> JSON -> OpenAI prompt -> Fal image pipeline.

Example:
    python3 backend/main.py "What are the most relevant historical periods of India"
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

# Make both `python3 backend/main.py` and `python3 -m backend.main` work.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.generate_photos import (
    call_fal,
    download_image,
    load_dotenv,
    sort_results,
    unique_output_name,
)
from backend.knowledge_search import build_records, call_cala_knowledge_search


OPENAI_URL = "https://api.openai.com/v1/responses"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


def topic_slug(query: str) -> str:
    """Create a short output-directory name from a natural-language query."""
    match = re.search(r"\b(?:of|for)\s+([A-Za-z][A-Za-z-]*)\s*$", query.strip(), re.IGNORECASE)
    value = match.group(1) if match else query
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "results"


def build_openai_input(result: Dict[str, str]) -> str:
    """Ask OpenAI to create a Fal-ready prompt from one Cala result."""
    fact = result.get("fact", "").strip()
    timeline = result.get("timeline", "").strip()
    if not fact or not timeline:
        raise ValueError("Each Cala result must contain a fact and timeline")
    return (
        "Create one concise image-generation prompt for a historically grounded editorial illustration. "
        "Use only the source fact and period below; do not add historical claims. Prefer architecture, "
        "landscapes, maps, objects, textiles, or ships over identifiable real people. Use a painterly "
        "style, restrained palette, parchment texture, cinematic light, no text, no labels, and no watermark. "
        "Return only the image prompt.\n\n"
        f"Period: {timeline}\nSource fact: {fact}"
    )


def extract_response_text(response: Dict[str, Any]) -> str:
    """Extract text from an OpenAI Responses API response."""
    output_text = response.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    chunks = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                chunks.append(content["text"])
    text = "\n".join(chunks).strip()
    if not text:
        raise RuntimeError("OpenAI response did not contain text")
    return text


def prepare_results(results: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Normalize missing timelines and sort dated results chronologically."""
    dated = []
    undated = []
    for result in results:
        if result.get("timeline", "").strip():
            dated.append(result)
        else:
            result["timeline"] = "undated"
            undated.append(result)
    return sort_results(dated) + undated


def call_openai(prompt_input: str, api_key: str, model: str) -> str:
    payload = {
        "model": model,
        "store": False,
        "instructions": "You are an art director creating safe, historically faithful image prompts.",
        "input": prompt_input,
    }
    request = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return extract_response_text(json.loads(response.read().decode("utf-8")))


def save_json(path: Path, query: str, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"query": query, "results": results}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", nargs="?", default="What are the most relevant historical periods of India")
    parser.add_argument("--json-output", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--openai-model", default=os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL))
    parser.add_argument("--fal-model", default=os.environ.get("FAL_MODEL", "fal-ai/flux/schnell"))
    parser.add_argument("--max-results", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Save Cala JSON and print prompts without calling OpenAI or Fal")
    args = parser.parse_args()

    root = PROJECT_ROOT
    load_dotenv(root / ".env")
    cala_key = os.environ.get("CALA_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    fal_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    if not cala_key:
        raise RuntimeError("Missing CALA_API_KEY")
    if not args.dry_run and (not openai_key or not fal_key):
        raise RuntimeError("Missing OPENAI_API_KEY or FAL_KEY/FAL_API_KEY")

    print(f"Searching Cala: {args.query}")
    cala_result = call_cala_knowledge_search(args.query, cala_key)
    results = prepare_results(build_records(cala_result))
    if args.max_results is not None:
        if args.max_results < 1:
            raise ValueError("--max-results must be at least 1")
        results = results[: args.max_results]

    slug = topic_slug(args.query)
    json_path = args.json_output or root / "data" / f"knowledge-search-{slug}.json"
    if not json_path.is_absolute():
        json_path = root / json_path
    output_dir = args.output_dir or root / "data" / "ohotos" / slug
    if not output_dir.is_absolute():
        output_dir = root / output_dir

    # Persist the Cala response before any downstream model call.
    save_json(json_path, args.query, results)
    print(f"Saved {len(results)} Cala results to {json_path}")

    used_names = set()
    for index, result in enumerate(results, start=1):
        prompt = (
            "Create an illustrated historical scene. "
            f"Period: {result['timeline']}. Source fact: {result['fact']}"
            if args.dry_run
            else call_openai(build_openai_input(result), openai_key, args.openai_model)
        )
        filename = unique_output_name(result["timeline"], used_names)
        output_path = output_dir / f"{index:02d}_{filename}"
        result["image_prompt"] = prompt
        result["image_file"] = str(output_path)
        print(f"{index:02d}. {result['timeline']} -> {output_path}")
        if args.dry_run:
            print(f"    {prompt}")
            continue
        if output_path.exists():
            print("    exists; skipping")
            continue
        image_url = call_fal(prompt, fal_key, args.fal_model)
        output_dir.mkdir(parents=True, exist_ok=True)
        download_image(image_url, output_path)

    save_json(json_path, args.query, results)
    print(f"Updated JSON with prompts: {json_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
