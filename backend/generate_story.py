"""Build six source-grounded country moments with GPT-5 and Fal Nano Banana Pro.

    python3 -m backend.generate_story --input data/knowledge-search-spain.json \
      --country-code ESP --country-name Spain --country-slug spain
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

from backend.story_pipeline import (
    append_fal_log,
    build_curator_input,
    build_fal_prompt,
    build_frontend_story,
    deterministic_seed,
    normalize_cala_records,
    story_schema,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OPENAI_URL = "https://api.openai.com/v1/responses"


def project_path(path):
    path = Path(path)
    return path if path.is_absolute() else PROJECT_ROOT / path


def load_dotenv(path):
    """Load uncommitted local credentials without overwriting exported environment variables."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def request_json(url, payload, authorization, timeout=180):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": authorization, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def response_output_text(payload):
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise RuntimeError("OpenAI Responses API did not return output text")


def curate_story(country_name, candidates, api_key, model):
    payload = request_json(
        OPENAI_URL,
        {
            "model": model,
            "store": False,
            "instructions": (
                "You are a meticulous historical curator. Treat the supplied Cala records as the only "
                "factual authority. Write no unsupported details."
            ),
            "input": build_curator_input(country_name, candidates),
            "text": {"format": {"type": "json_schema", "name": "historical_story", "strict": True, "schema": story_schema()}},
        },
        f"Bearer {api_key}",
        timeout=300,
    )
    try:
        return json.loads(response_output_text(payload))
    except json.JSONDecodeError as error:
        raise RuntimeError("OpenAI returned invalid curator JSON") from error


def fal_image_url(model, arguments, api_key):
    payload = request_json(f"https://fal.run/{model}", arguments, f"Key {api_key}")
    try:
        url = payload["images"][0]["url"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError(f"Fal {model} response did not contain an image URL") from error
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("Fal returned an invalid image URL")
    return url


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    try:
        with urllib.request.urlopen(url, timeout=180) as response:
            temporary.write_bytes(response.read())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def load_profile(profile_path):
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    required = {
        "version", "reference_version", "reference_image_path", "generation_model",
        "aspect_ratio", "resolution", "output_format", "style", "constraints",
    }
    missing = required.difference(profile)
    if missing:
        raise ValueError(f"Style profile is missing: {', '.join(sorted(missing))}")
    return profile


def reference_data_uri(path):
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build_nano_banana_prompt(event, profile):
    return (
        f"{build_fal_prompt(event, profile)} "
        "The supplied panorama is a composition and style reference only. Preserve its ultra-wide elevated "
        "viewpoint, layered ridge-to-valley depth, broad horizon, and quiet foreground framing. Do not copy "
        "its people, flags, costumes, or specific buildings."
    )


def run_pipeline(input_path, country_code, country_name, profile_path, openai_key, fal_key, openai_model, country_slug=None, project_root=PROJECT_ROOT):
    profile = load_profile(profile_path)
    reference_path = project_path(profile["reference_image_path"])
    if not reference_path.exists():
        raise RuntimeError(f"Panorama reference image not found: {reference_path}")
    country_slug = country_slug or re.sub(r"[^a-z0-9]+", "-", country_name.lower()).strip("-")
    document = json.loads(input_path.read_text(encoding="utf-8"))
    candidates = normalize_cala_records(document)
    print("Curating six source-linked moments with GPT-5...", flush=True)
    curated = curate_story(country_name, candidates, openai_key, openai_model)
    story = build_frontend_story(country_code, country_name, curated, candidates, profile, asset_slug=country_slug)
    image_dir = project_root / "frontend" / "public" / "moments" / country_slug
    fal_events = []
    candidate_by_index = {candidate["source_index"]: candidate for candidate in candidates}
    panorama_data_uri = reference_data_uri(reference_path)

    for moment, event in zip(story["moments"], curated["events"]):
        print(f"Generating {moment['orderIndex'] + 1}/6: {moment['id']}...", flush=True)
        seed = deterministic_seed(country_code, moment["id"], profile["version"])
        final_prompt = build_nano_banana_prompt(event, profile)
        image_url = fal_image_url(profile["generation_model"], {
            "prompt": final_prompt,
            "image_urls": [panorama_data_uri],
            "num_images": 1,
            "aspect_ratio": profile["aspect_ratio"],
            "resolution": profile["resolution"],
            "output_format": profile["output_format"],
            "seed": seed,
            "safety_tolerance": "4",
            "limit_generations": True,
        }, fal_key)
        output_path = image_dir / Path(moment["imagePath"]).name
        download(image_url, output_path)
        fal_events.append({
            "order": moment["orderIndex"] + 1,
            "event_id": moment["id"],
            "timeline": str(moment["year"]),
            "fal_prompt": final_prompt,
            "seed": seed,
            "output_image_path": str(output_path.relative_to(project_root)),
            "source_records": [candidate_by_index[index] for index in event["source_indices"]],
        })

    frontend_path = project_root / "frontend" / "data" / f"{country_slug}.json"
    frontend_path.parent.mkdir(parents=True, exist_ok=True)
    frontend_path.write_text(json.dumps(story, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    append_fal_log(project_root / "data" / "fal.json", {
        "country": country_name,
        "country_code": country_code.upper(),
        "input_knowledge_search_file": str(input_path.relative_to(project_root)),
        "style_profile_version": profile["version"],
        "generation_model": profile["generation_model"],
        "aspect_ratio": profile["aspect_ratio"],
        "resolution": profile["resolution"],
        "reference_version": profile["reference_version"],
        "reference_image_path": str(reference_path.relative_to(project_root)),
        "events": fal_events,
    })
    return frontend_path, fal_events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/knowledge-search-spain.json"))
    parser.add_argument("--country-code", default="ESP")
    parser.add_argument("--country-name", default="Spain")
    parser.add_argument("--profile", type=Path, default=Path("data/styles/museum-editorial-v1.json"))
    parser.add_argument("--country-slug", default="spain")
    parser.add_argument("--openai-model", default=os.environ.get("OPENAI_MODEL", "gpt-5"))
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env")
    input_path = project_path(args.input)
    profile_path = project_path(args.profile)
    fal_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key or not fal_key:
        raise RuntimeError("Missing OPENAI_API_KEY or FAL_KEY/FAL_API_KEY")
    frontend_path, events = run_pipeline(input_path, args.country_code, args.country_name, profile_path, openai_key, fal_key, args.openai_model, country_slug=args.country_slug)
    print(f"Wrote {len(events)} moments to {frontend_path}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
