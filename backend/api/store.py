"""File-backed job and country store for the local generation API.

State lives in `backend/state/` as plain JSON: one `countries.json` index plus one file per
job. No database, matching the rest of this project.

The store's real job is preventing duplicate work. A country takes ~15 minutes and costs real
API credit, so two clicks must never start two runs. Every read-modify-write that could
create a job is serialised behind a lock file.
"""

import errno
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline_common import (  # noqa: E402
    PROJECT_ROOT,
    country_paths,
    read_json,
    slugify,
    utc_now_iso,
    write_json,
)

DEFAULT_STATE_ROOT = PROJECT_ROOT / "backend" / "state"

# Job lifecycle. `ready` and `failed` are terminal.
QUEUED = "queued"
RUNNING = "running"
READY = "ready"
FAILED = "failed"
ACTIVE_STATUSES = (QUEUED, RUNNING)

# Pipeline stages, in order, mirroring backend/run_pipeline.py.
STAGES = ("facts", "prompts", "images", "videos")

STAGE_MESSAGES = {
    "facts": "Gathering historical facts",
    "prompts": "Writing image prompts",
    "images": "Painting the scenes",
    "videos": "Animating the panoramas",
}

LOCK_TIMEOUT_SECONDS = 10
LOCK_STALE_SECONDS = 60


class LockTimeout(RuntimeError):
    """Raised when the state lock cannot be acquired."""


class FileLock:
    """A lock file guarding the state directory.

    `O_CREAT | O_EXCL` is atomic on every platform this runs on, so it is enough to serialise
    the two processes that touch state (API and worker). A lock older than LOCK_STALE_SECONDS
    is treated as abandoned by a killed process and broken, so a crash cannot wedge the API.
    """

    def __init__(self, path, timeout=LOCK_TIMEOUT_SECONDS):
        self.path = Path(path)
        self.timeout = timeout
        self._fd = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self._fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self._fd, str(os.getpid()).encode("ascii"))
                return self
            except OSError as error:
                if error.errno != errno.EEXIST:
                    raise
                if self._break_if_stale():
                    continue
                if time.monotonic() > deadline:
                    raise LockTimeout(f"Could not acquire {self.path} within {self.timeout}s")
                time.sleep(0.05)

    def _break_if_stale(self):
        try:
            age = time.time() - self.path.stat().st_mtime
        except OSError:
            return True  # vanished between the failed create and the stat; retry immediately
        if age > LOCK_STALE_SECONDS:
            self.path.unlink(missing_ok=True)
            return True
        return False

    def __exit__(self, *exc_info):
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        self.path.unlink(missing_ok=True)
        return False


def normalize_code(code):
    """Uppercase ISO-3 code, or None when it cannot be one.

    Natural Earth writes "-99" for France, Norway, Kosovo, Northern Cyprus and Somaliland.
    Rejecting it here stops a `backend/output/-99/` directory ever being created.
    """
    if not isinstance(code, str):
        return None
    candidate = code.strip().upper()
    if len(candidate) != 3 or not candidate.isalpha():
        return None
    return candidate


class Store:
    def __init__(self, state_root=None, output_root=None):
        self.state_root = Path(state_root) if state_root else DEFAULT_STATE_ROOT
        self.output_root = Path(output_root) if output_root else None
        self.jobs_dir = self.state_root / "jobs"
        self.countries_path = self.state_root / "countries.json"
        self.lock_path = self.state_root / ".lock"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    # -- raw persistence -------------------------------------------------

    def _read_countries(self):
        if not self.countries_path.is_file():
            return {}
        try:
            document = read_json(self.countries_path)
        except ValueError:
            return {}
        countries = document.get("countries")
        return countries if isinstance(countries, dict) else {}

    def _write_countries(self, countries):
        write_json(self.countries_path, {"updated_at": utc_now_iso(), "countries": countries})

    def job_path(self, job_id):
        return self.jobs_dir / f"{job_id}.json"

    def read_job(self, job_id):
        path = self.job_path(job_id)
        if not path.is_file():
            return None
        try:
            return read_json(path)
        except ValueError:
            return None

    def _write_job(self, job):
        write_json(self.job_path(job["id"]), job)

    def list_jobs(self):
        jobs = []
        for path in sorted(self.jobs_dir.glob("*.json")):
            try:
                jobs.append(read_json(path))
            except ValueError:
                continue
        return jobs

    # -- country helpers -------------------------------------------------

    def paths_for(self, name):
        return country_paths(name, self.output_root)

    def media_state(self, name):
        """(has_images, has_videos) for a country, judged by real files on disk.

        Manifests alone are not trusted: stage 3 and 4 write them even on a partial run, so a
        manifest with no accompanying file would report media that cannot be served.
        """
        paths = self.paths_for(name)
        images = sorted(paths["images_dir"].glob("*.jpeg")) + sorted(paths["images_dir"].glob("*.jpg"))
        videos = sorted((paths["dir"] / "videos").glob("*.mp4"))
        return bool(images), bool(videos)

    def list_countries(self):
        return list(self._read_countries().values())

    def get_country(self, code):
        return self._read_countries().get(code)

    # -- seeding ---------------------------------------------------------

    def seed_from_disk(self, known_names=None):
        """Mark already-generated countries `ready` so they are never regenerated.

        Scans the output directory rather than trusting the index, so a country generated
        from the CLI (as Spain was) is picked up on first API start.
        """
        root = self.output_root or (PROJECT_ROOT / "backend" / "output")
        root = Path(root)
        if not root.is_dir():
            return []

        names_by_slug = {slugify(n): n for n in (known_names or [])}
        seeded = []
        with FileLock(self.lock_path):
            countries = self._read_countries()
            for directory in sorted(p for p in root.iterdir() if p.is_dir()):
                slug = directory.name
                name = names_by_slug.get(slug, slug.replace("-", " ").title())
                has_images, has_videos = self.media_state(name)
                if not (has_images and has_videos):
                    continue
                existing = next(
                    (c for c in countries.values() if c.get("slug") == slug), None
                )
                if existing and existing.get("status") == READY:
                    continue
                code = (existing or {}).get("code") or f"@{slug}"
                countries[code] = {
                    "code": code,
                    "name": (existing or {}).get("name") or name,
                    "slug": slug,
                    "status": READY,
                    "output_dir": str(directory.relative_to(PROJECT_ROOT))
                    if _within(directory, PROJECT_ROOT) else str(directory),
                    "job_id": (existing or {}).get("job_id"),
                    "seeded": True,
                }
                seeded.append(code)
            if seeded:
                self._write_countries(countries)
        return seeded

    def register_known_country(self, code, name):
        """Attach a real ISO-3 code to a country that was seeded under a placeholder key."""
        code = normalize_code(code)
        if not code:
            return None
        slug = slugify(name)
        with FileLock(self.lock_path):
            countries = self._read_countries()
            placeholder = f"@{slug}"
            if code not in countries and placeholder in countries:
                entry = countries.pop(placeholder)
                entry["code"] = code
                entry["name"] = name
                countries[code] = entry
                self._write_countries(countries)
                return entry
            return countries.get(code)

    # -- job lifecycle ---------------------------------------------------

    def request_generation(self, code, name):
        """Return (job, created). Never starts a second run for the same country.

        A country that is already `ready`, or that has a queued/running job, returns what it
        has. Only a country with no active job gets a new one -- which is what makes repeated
        clicks safe.
        """
        code = normalize_code(code)
        if not code:
            raise ValueError("code must be a 3-letter ISO-3166 alpha-3 country code")
        name = (name or "").strip()
        if not name:
            raise ValueError("name is required")
        slug = slugify(name)
        if not slug:
            raise ValueError(f"name {name!r} does not produce a usable slug")

        with FileLock(self.lock_path):
            countries = self._read_countries()
            entry = countries.get(code)

            if entry:
                active = self._active_job_for(entry)
                if active:
                    return active, False
                if entry.get("status") == READY:
                    has_images, has_videos = self.media_state(entry.get("name") or name)
                    if has_images and has_videos:
                        return self._synthetic_ready_job(entry), False

            job = self._new_job(code, name, slug)
            self._write_job(job)
            countries[code] = {
                "code": code,
                "name": name,
                "slug": slug,
                "status": QUEUED,
                "output_dir": str(self.paths_for(name)["dir"].relative_to(PROJECT_ROOT))
                if _within(self.paths_for(name)["dir"], PROJECT_ROOT)
                else str(self.paths_for(name)["dir"]),
                "job_id": job["id"],
            }
            self._write_countries(countries)
            return job, True

    def _active_job_for(self, entry):
        job_id = entry.get("job_id")
        if not job_id:
            return None
        job = self.read_job(job_id)
        if job and job.get("status") in ACTIVE_STATUSES:
            return job
        return None

    def _synthetic_ready_job(self, entry):
        """A ready country may predate the API (Spain). Report it without inventing a run."""
        job_id = entry.get("job_id")
        if job_id:
            job = self.read_job(job_id)
            if job:
                return job
        return {
            "id": None,
            "code": entry["code"],
            "name": entry["name"],
            "slug": entry["slug"],
            "status": READY,
            "stage": "videos",
            "message": "Already generated",
            "created_at": None,
            "updated_at": None,
            "error": None,
        }

    def _new_job(self, code, name, slug):
        now = utc_now_iso()
        return {
            "id": uuid.uuid4().hex,
            "code": code,
            "name": name,
            "slug": slug,
            "status": QUEUED,
            "stage": None,
            "message": "Queued",
            "created_at": now,
            "updated_at": now,
            "started_at": None,
            "finished_at": None,
            "error": None,
        }

    def claim_next_job(self):
        """Atomically take the oldest queued job. Returns None when the queue is empty."""
        with FileLock(self.lock_path):
            queued = [j for j in self.list_jobs() if j.get("status") == QUEUED]
            if not queued:
                return None
            job = sorted(queued, key=lambda j: j.get("created_at") or "")[0]
            job["status"] = RUNNING
            job["started_at"] = utc_now_iso()
            job["updated_at"] = job["started_at"]
            job["message"] = "Starting"
            self._write_job(job)
            self._set_country_status(job["code"], RUNNING)
            return job

    def set_stage(self, job_id, stage):
        with FileLock(self.lock_path):
            job = self.read_job(job_id)
            if not job:
                return None
            job["stage"] = stage
            job["message"] = STAGE_MESSAGES.get(stage, stage)
            job["updated_at"] = utc_now_iso()
            self._write_job(job)
            return job

    def finish_job(self, job_id, status, error=None):
        with FileLock(self.lock_path):
            job = self.read_job(job_id)
            if not job:
                return None
            job["status"] = status
            job["error"] = error
            job["finished_at"] = utc_now_iso()
            job["updated_at"] = job["finished_at"]
            job["message"] = "Ready" if status == READY else (error or "Failed")
            self._write_job(job)
            self._set_country_status(job["code"], status)
            return job

    def _set_country_status(self, code, status):
        """Caller must already hold the lock."""
        countries = self._read_countries()
        entry = countries.get(code)
        if not entry:
            return
        entry["status"] = status
        countries[code] = entry
        self._write_countries(countries)

    def fail_interrupted_jobs(self, reason="Interrupted by a worker restart"):
        """Mark jobs left `running` by a killed worker as failed.

        Without this a crashed run leaves a job running forever and the country can never be
        retried. Failing it explicitly means the next request creates a fresh retry job.
        """
        failed = []
        with FileLock(self.lock_path):
            for job in self.list_jobs():
                if job.get("status") != RUNNING:
                    continue
                job["status"] = FAILED
                job["error"] = reason
                job["message"] = reason
                job["finished_at"] = utc_now_iso()
                job["updated_at"] = job["finished_at"]
                self._write_job(job)
                self._set_country_status(job["code"], FAILED)
                failed.append(job["id"])
        return failed


def _within(path, parent):
    """Path.is_relative_to equivalent -- this project targets Python 3.8."""
    try:
        Path(path).relative_to(parent)
        return True
    except ValueError:
        return False
