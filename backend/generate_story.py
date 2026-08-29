"""Build a six-moment, source-grounded country story and its Fal images.

The command deliberately separates anchor approval from story generation:

  python3 -m backend.generate_story --create-anchor-candidates
  python3 -m backend.generate_story --select-anchor 2
  python3 -m backend.generate_story --input data/knowledge-search-spain.json --country-code ESP --country-name Spain
"""

import argparse
import json
import os
import re
import shutil
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
ANCHOR_PROMPT = (
    "Museum-editorial historical illustration style anchor, an unlabelled conservation table with "
    "weathered map fragments, a ceramic vessel, a textile sample, and a small brass instrument; "
    "muted indigo and ochre palette, restrained saturation, archival paper grain, soft directional "
    "light, quiet balanced composition, no people, no text, no labels, no watermark, no modern objects."
)


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
        timeout=120,
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


def upload_anchor(anchor_path):
    """Upload the approved local anchor to Fal CDN for the edit model."""
    try:
        import fal_client
    except ImportError as error:
        raise RuntimeError("Anchor uploads require fal-client; install backend/requirements.txt") from error
    url = fal_client.upload_file(str(anchor_path))
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("Fal CDN did not return an HTTPS URL for the approved anchor")
    return url


def load_profile(profile_path):
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    required = {"version", "anchor_path", "generation_model", "edit_model", "image_size", "output_format", "style", "constraints"}
    missing = required.difference(profile)
    if missing:
        raise ValueError(f"Style profile is missing: {', '.join(sorted(missing))}")
    return profile


def promote_anchor(profile_path, candidate_number):
    profile = load_profile(profile_path)
    candidates = profile_path.parent / profile["version"] / "candidates"
    source = candidates / f"anchor-{candidate_number}.jpg"
    if not source.exists():
        raise FileNotFoundError(f"Anchor candidate not found: {source}")
    destination = project_path(profile["anchor_path"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    profile["anchor_version"] = f"{profile['version']}-anchor-{candidate_number}"
    profile_path.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf-8")
    return destination


def create_anchor_candidates(profile, profile_path, fal_key):
    candidates_dir = profile_path.parent / profile["version"] / "candidates"
    candidates = []
    for candidate_number in range(1, 4):
        seed = deterministic_seed("style-anchor", str(candidate_number), profile["version"])
        url = fal_image_url(profile["generation_model"], {
            "prompt": ANCHOR_PROMPT,
            "image_size": profile["image_size"],
            "output_format": profile["output_format"],
            "seed": seed,
            "enable_safety_checker": True,
        }, fal_key)
        path = candidates_dir / f"anchor-{candidate_number}.jpg"
        download(url, path)
        candidates.append(path)
    return candidates


def event_edit_prompt(event, profile):
    return (
        "Use the second reference image as the mandatory visual style anchor. Preserve the first "
        "reference image's historically grounded subject and composition while applying its museum-editorial "
        f"finish. Event visual brief: {event['visual_brief']}. Style profile: {profile['version']}. "
        "Do not add text, labels, watermarks, modern objects, or identifiable people unless sourced."
    )


def run_pipeline(input_path, country_code, country_name, profile_path, openai_key, fal_key, openai_model, project_root=PROJECT_ROOT):
    profile = load_profile(profile_path)
    anchor_path = project_path(profile["anchor_path"])
    if not profile.get("anchor_version") or not anchor_path.exists():
        raise RuntimeError("No approved style anchor. Generate candidates, inspect them, then use --select-anchor.")
    document = json.loads(input_path.read_text(encoding="utf-8"))
    candidates = normalize_cala_records(document)
    curated = curate_story(country_name, candidates, openai_key, openai_model)
    story = build_frontend_story(country_code, country_name, curated, candidates, profile)
    anchor_url = upload_anchor(anchor_path)
    image_dir = project_root / "frontend" / "public" / "moments" / country_code.lower()
    fal_events = []
    candidate_by_index = {candidate["source_index"]: candidate for candidate in candidates}

    for moment, event in zip(story["moments"], curated["events"]):
        seed = deterministic_seed(country_code, moment["id"], profile["version"])
        final_prompt = build_fal_prompt(event, profile)
        base_url = fal_image_url(profile["generation_model"], {
            "prompt": final_prompt,
            "image_size": profile["image_size"],
            "output_format": profile["output_format"],
            "seed": seed,
            "enable_safety_checker": True,
        }, fal_key)
        edited_url = fal_image_url(profile["edit_model"], {
            "prompt": event_edit_prompt(event, profile),
            "image_urls": [base_url, anchor_url],
            "image_size": profile["image_size"],
            "output_format": profile["output_format"],
            "seed": seed,
            "enable_safety_checker": True,
        }, fal_key)
        output_path = image_dir / Path(moment["imagePath"]).name
        download(edited_url, output_path)
        fal_events.append({
            "order": moment["orderIndex"] + 1,
            "event_id": moment["id"],
            "timeline": str(moment["year"]),
            "fal_prompt": final_prompt,
            "anchor_edit_prompt": event_edit_prompt(event, profile),
            "seed": seed,
            "output_image_path": str(output_path.relative_to(project_root)),
            "source_records": [candidate_by_index[index] for index in event["source_indices"]],
        })

    frontend_path = project_root / "frontend" / "data" / f"{country_code.lower()}.json"
    frontend_path.parent.mkdir(parents=True, exist_ok=True)
    frontend_path.write_text(json.dumps(story, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    append_fal_log(project_root / "data" / "fal.json", {
        "country": country_name,
        "country_code": country_code.upper(),
        "input_knowledge_search_file": str(input_path.relative_to(project_root)),
        "style_profile_version": profile["version"],
        "anchor_version": profile["anchor_version"],
        "generation_model": profile["generation_model"],
        "edit_model": profile["edit_model"],
        "events": fal_events,
    })
    return frontend_path, fal_events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/knowledge-search-spain.json"))
    parser.add_argument("--country-code", default="ESP")
    parser.add_argument("--country-name", default="Spain")
    parser.add_argument("--profile", type=Path, default=Path("data/styles/museum-editorial-v1.json"))
    parser.add_argument("--openai-model", default=os.environ.get("OPENAI_MODEL", "gpt-5"))
    parser.add_argument("--create-anchor-candidates", action="store_true")
    parser.add_argument("--select-anchor", type=int, choices=(1, 2, 3))
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env")
    input_path = project_path(args.input)
    profile_path = project_path(args.profile)
    profile = load_profile(profile_path)
    if args.select_anchor:
        print(f"Approved anchor: {promote_anchor(profile_path, args.select_anchor)}")
        return

    fal_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    if args.create_anchor_candidates:
        if not fal_key:
            raise RuntimeError("Missing FAL_KEY or FAL_API_KEY")
        for path in create_anchor_candidates(profile, profile_path, fal_key):
            print(f"Created candidate: {path}")
        print("Inspect the three candidates and run again with --select-anchor 1, 2, or 3.")
        return

    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key or not fal_key:
        raise RuntimeError("Missing OPENAI_API_KEY or FAL_KEY/FAL_API_KEY")
    frontend_path, events = run_pipeline(input_path, args.country_code, args.country_name, profile_path, openai_key, fal_key, args.openai_model)
    print(f"Wrote {len(events)} moments to {frontend_path}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
