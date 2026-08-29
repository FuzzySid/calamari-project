#!/usr/bin/env python3
"""Run all three pipeline stages for one or many countries.

Each stage runs as a subprocess so a crash in one cannot take down the batch, and
each country is isolated: a failure on the fifth country leaves the first four's
outputs untouched. Stages skip work that already exists, so re-running a batch
resumes rather than regenerating — the paid Fal calls are not repeated.

Standard library only.

Usage:
  python3 backend/run_pipeline.py --country Spain
  python3 backend/run_pipeline.py --countries Spain Japan Brazil
  python3 backend/run_pipeline.py --country Spain --dry-run
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import country_paths

BACKEND_DIR = Path(__file__).resolve().parent

STAGES = (
    ("facts", "stage1_facts.py"),
    ("prompts", "stage2_prompts.py"),
    ("images", "stage3_images.py"),
)


def run_stage(script, country, extra_args):
    """Run one stage as a subprocess, streaming its output. Raises on failure."""
    command = [sys.executable, str(BACKEND_DIR / script), "--country", country, *extra_args]
    result = subprocess.run(command)
    if result.returncode != 0:
        raise RuntimeError(f"{script} exited with code {result.returncode}")


def run_country(country, output_root=None, limit=None, images_per_event=None,
                openai_model=None, profile=None, force=False, dry_run=False):
    """Run facts -> prompts -> images for a single country, in order."""
    shared = []
    if output_root:
        shared += ["--output-root", str(output_root)]
    if force:
        shared.append("--force")
    if dry_run:
        shared.append("--dry-run")

    paths = country_paths(country, output_root)

    for name, script in STAGES:
        extra = list(shared)
        # Stage 1 has neither --force nor --dry-run: its Cala call is the one step that
        # cannot be simulated, so skip it outright when its output already exists.
        if name == "facts":
            if paths["info"].is_file() and not force:
                print(f"\n=== {country}: stage facts (skipped, {paths['info'].name} exists) ===", flush=True)
                continue
            if dry_run:
                print(f"\n=== {country}: stage facts (skipped, --dry-run cannot simulate Cala) ===", flush=True)
                continue
            extra = ["--output-root", str(output_root)] if output_root else []
            if limit is not None:
                extra += ["--limit", str(limit)]
        elif name == "prompts" and openai_model:
            extra += ["--openai-model", openai_model]
        elif name == "images":
            if profile:
                extra += ["--profile", str(profile)]
            if images_per_event is not None:
                extra += ["--images-per-event", str(images_per_event)]

        print(f"\n=== {country}: stage {name} ===", flush=True)
        run_stage(script, country, extra)

    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--country", help="A single country name, e.g. \"Spain\".")
    group.add_argument("--countries", nargs="+", help="Several country names to run in sequence.")
    parser.add_argument("--limit", type=int, default=None, help="Events per country (stage 1 default: 5).")
    parser.add_argument("--images-per-event", type=int, default=None, help="Images per event (default 1).")
    parser.add_argument("--openai-model", default=None)
    parser.add_argument("--profile", default=None, help="Style profile for stage 3.")
    parser.add_argument("--output-root", default=None)
    parser.add_argument("--force", action="store_true", help="Regenerate prompts and images that already exist.")
    parser.add_argument("--dry-run", action="store_true", help="Stages 2 and 3 print their work without calling APIs.")
    args = parser.parse_args()

    countries = args.countries or [args.country]
    succeeded, failed = [], []

    for country in countries:
        try:
            run_country(
                country,
                output_root=args.output_root,
                limit=args.limit,
                images_per_event=args.images_per_event,
                openai_model=args.openai_model,
                profile=args.profile,
                force=args.force,
                dry_run=args.dry_run,
            )
            succeeded.append(country)
        except (RuntimeError, OSError, ValueError) as error:
            # Isolate the failure: later countries still run, earlier outputs stay intact.
            print(f"\nFAILED {country}: {error}", file=sys.stderr, flush=True)
            failed.append((country, str(error)))

    print("\n=== summary ===")
    for country in succeeded:
        print(f"  ok      {country}")
    for country, error in failed:
        print(f"  FAILED  {country}: {error}")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
