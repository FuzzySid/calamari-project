"""Shared helpers for the three-stage country pipeline.

Stage 1 (facts, Cala) -> Stage 2 (prompts, OpenAI) -> Stage 3 (images, Fal).

Every stage derives its paths from `country_paths()` so the on-disk layout is defined
in exactly one place, and no stage hardcodes a country. Standard library only.
"""

import hashlib
import json
import os
import re
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "backend" / "output"

# Keys whose values must never reach a log file on disk.
SENSITIVE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "token",
    "fal_key",
    "fal_api_key",
    "openai_api_key",
    "cala_api_key",
    "x-api-key",
}


def project_path(path):
    """Resolve a possibly-relative path against the repo root."""
    path = Path(path)
    return path if path.is_absolute() else PROJECT_ROOT / path


def slugify(text):
    """"Spain" -> "spain"; "Côte d'Ivoire" -> "cote-d-ivoire".

    The single source of truth for country slugs, event ids and filenames. Accents are
    folded to ASCII so a slug is always filesystem- and URL-safe.
    """
    normalized = unicodedata.normalize("NFKD", str(text))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def country_paths(country, output_root=None):
    """Every output path for one country, derived from its slug.

    Returns a dict with: slug, dir, info, prompts, images (manifest), images_dir, run_log.
    """
    slug = slugify(country)
    if not slug:
        raise ValueError(f"Country name produced an empty slug: {country!r}")
    root = Path(output_root) if output_root else DEFAULT_OUTPUT_ROOT
    root = project_path(root)
    country_dir = root / slug
    return {
        "slug": slug,
        "dir": country_dir,
        "info": country_dir / "info.json",
        "prompts": country_dir / "prompts_image.json",
        "images": country_dir / "images.json",
        "images_dir": country_dir / "images",
        "run_log": country_dir / "run_log.json",
    }


def load_dotenv(path=None):
    """Load KEY=VALUE lines from .env without overriding exported shell variables."""
    path = Path(path) if path else PROJECT_ROOT / ".env"
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


def require_env(*names):
    """Return the first environment variable that is set, else raise.

    Callers pass a fallback chain: the repo .env defines FAL_API_KEY while Fal's own docs
    say FAL_KEY, so both spellings must work.
    """
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    raise RuntimeError(f"Missing required environment variable: {' or '.join(names)}")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    """Write JSON atomically so an interrupted run cannot leave a truncated file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def request_json(url, payload, headers=None, timeout=180):
    """POST JSON and parse the JSON response. Raises on transport or decode failure."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url, destination, timeout=180):
    """Download to a .tmp sibling then atomically replace, so a partial file never lands."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            temporary.write_bytes(response.read())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def deterministic_seed(country_slug, event_id, profile_version, variant=1):
    """A stable seed per (country, event, style version, variant).

    Re-running Stage 3 with --force reproduces the same image rather than a new one, and
    two countries can never collide on a seed.
    """
    key = f"{country_slug}:{event_id}:{profile_version}:{variant}"
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 2147483647


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def scrub_secrets(value):
    """Recursively redact credential-bearing keys before anything is written to disk."""
    if isinstance(value, dict):
        return {
            key: ("[REDACTED]" if key.lower() in SENSITIVE_KEYS else scrub_secrets(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [scrub_secrets(item) for item in value]
    return value


def append_run_log(path, run):
    """Append one run to an append-only {"runs": [...]} log, stamped and scrubbed.

    Matches the shape of the existing data/fal.json so older logs stay readable.
    """
    path = Path(path)
    document = {"runs": []}
    if path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(existing, dict) and isinstance(existing.get("runs"), list):
                document = existing
        except json.JSONDecodeError:
            # A corrupt log must not abort a run that already cost API calls.
            document = {"runs": []}
    document["runs"].append({"generated_at": utc_now_iso(), **scrub_secrets(run)})
    write_json(path, document)
