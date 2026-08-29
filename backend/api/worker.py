"""Worker that runs queued country generations, one at a time.

    python3 -m backend.api.worker

Deliberately single-threaded: each country costs real API credit and pins the machine for
~15 minutes, so concurrent runs would multiply spend and thrash the box. Runs as its own
process so a pipeline crash can never take the API down with it.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from run_pipeline import run_country  # noqa: E402

from .store import FAILED, READY, Store  # noqa: E402

POLL_INTERVAL_SECONDS = 2
EVENTS_PER_COUNTRY = 5


def process_job(job, store, runner=run_country):
    """Run one job to completion and record the outcome. Never raises."""
    print(f"[worker] {job['code']} {job['name']}: starting", flush=True)
    try:
        runner(
            job["name"],
            limit=EVENTS_PER_COUNTRY,
            with_videos=True,
            on_stage=lambda stage: store.set_stage(job["id"], stage),
        )
    except Exception as error:
        # Broad by design: a stage failure must mark the job failed and let the worker carry
        # on, not kill the loop and strand every later job.
        message = f"{type(error).__name__}: {error}"
        print(f"[worker] {job['code']}: FAILED -- {message}", file=sys.stderr, flush=True)
        store.finish_job(job["id"], FAILED, error=message)
        return FAILED

    has_images, has_videos = store.media_state(job["name"])
    if not (has_images and has_videos):
        message = "Pipeline finished but produced no images or videos"
        print(f"[worker] {job['code']}: FAILED -- {message}", file=sys.stderr, flush=True)
        store.finish_job(job["id"], FAILED, error=message)
        return FAILED

    store.finish_job(job["id"], READY)
    print(f"[worker] {job['code']}: ready", flush=True)
    return READY


def run_forever(store, runner=run_country, poll_interval=POLL_INTERVAL_SECONDS, max_jobs=None):
    """Claim and process queued jobs until interrupted (or until max_jobs, for tests)."""
    interrupted = store.fail_interrupted_jobs()
    for job_id in interrupted:
        print(f"[worker] marked interrupted job {job_id} as failed", flush=True)

    processed = 0
    while max_jobs is None or processed < max_jobs:
        job = store.claim_next_job()
        if job is None:
            if max_jobs is not None:
                break
            time.sleep(poll_interval)
            continue
        process_job(job, store, runner=runner)
        processed += 1
    return processed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poll-interval", type=float, default=POLL_INTERVAL_SECONDS)
    parser.add_argument("--max-jobs", type=int, default=None, help="Exit after N jobs.")
    args = parser.parse_args()

    store = Store()
    print("[worker] waiting for jobs", flush=True)
    try:
        run_forever(store, poll_interval=args.poll_interval, max_jobs=args.max_jobs)
    except KeyboardInterrupt:
        print("\n[worker] stopped", flush=True)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
