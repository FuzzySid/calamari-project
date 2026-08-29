"""Generate one panorama-informed historical scene with Fal Nano Banana Pro."""

import base64
import json
import os
import sys
from pathlib import Path

from backend.generate_story import PROJECT_ROOT, download, fal_image_url, load_dotenv
from backend.story_pipeline import append_fal_log, deterministic_seed


MODEL = "fal-ai/nano-banana-pro"
REFERENCE = PROJECT_ROOT / "frontend/public/panoramas/castle-panorama.jpg"
OUTPUT = PROJECT_ROOT / "frontend/public/moments/spain/nano-banana-pro-al-andalus-trial.jpg"
PROMPT = """Use case: historical-scene
Asset type: 16:9 interactive historical panorama background for a Spain story.
Input image: the supplied panorama is a composition reference only. Preserve its wide elevated viewpoint, layered fortress ridges, deep central valley, broad horizon, and immersive foreground framing. Do not copy its people, flag, costumes, or specific castle.
Primary request: a historically grounded view of Al-Andalus in the Caliphate era (929–1031): a fortified Andalusian hilltop settlement, terraced orchards and an irrigation channel in a broad Iberian valley, a distant palace and mosque silhouette, ceramic vessels and woven textiles as subtle foreground details. No identifiable people.
Style/medium: refined museum-editorial historical illustration, muted indigo and ochre palette, restrained saturation, archival paper grain, tactile stone and plaster, soft directional late-afternoon light, calm and contemplative rather than spectacular.
Composition/framing: ultra-wide 16:9 panoramic landscape; deep valley centered between two elevated fortress ridges; usable quiet sky and horizon; layered depth from foreground parapet to distant mountains.
Constraints: historically grounded architecture and materials; no text, labels, logos, visible watermark, flags, modern objects, or anachronisms."""


def reference_data_uri(path):
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    load_dotenv(PROJECT_ROOT / ".env")
    fal_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
    if not fal_key:
        raise RuntimeError("Missing FAL_KEY or FAL_API_KEY")
    seed = deterministic_seed("ESP", "nano-banana-pro-al-andalus-trial", "museum-editorial-v1")
    url = fal_image_url(MODEL, {
        "prompt": PROMPT,
        "image_urls": [reference_data_uri(REFERENCE)],
        "num_images": 1,
        "aspect_ratio": "16:9",
        "resolution": "2K",
        "output_format": "jpeg",
        "seed": seed,
        "safety_tolerance": "4",
        "limit_generations": True,
    }, fal_key)
    download(url, OUTPUT)
    append_fal_log(PROJECT_ROOT / "data/fal.json", {
        "country": "Spain",
        "kind": "panorama-reference trial",
        "style_profile_version": "museum-editorial-v1",
        "generation_model": MODEL,
        "events": [{
            "order": 1,
            "event_id": "nano-banana-pro-al-andalus-trial",
            "timeline": "929–1031",
            "fal_prompt": PROMPT,
            "seed": seed,
            "reference_image": str(REFERENCE.relative_to(PROJECT_ROOT)),
            "output_image_path": str(OUTPUT.relative_to(PROJECT_ROOT)),
        }],
    })
    print(OUTPUT)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1)
