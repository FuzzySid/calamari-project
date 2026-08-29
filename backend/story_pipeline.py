"""Core functions for turning Cala research into a sourced visual story."""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


SENSITIVE_KEYS = {"api_key", "authorization", "token", "headers", "fal_key", "openai_api_key"}


def timeline_year(timeline):
    """Return an approximate first year for chronological ordering."""
    if not timeline:
        return None
    match = re.search(r"(?<!\d)(\d{1,3}(?:[,\.\u202f]\d{3})*|\d{1,4})(?!\d)", timeline)
    if not match:
        return None
    year = int(re.sub(r"[^0-9]", "", match.group(1)))
    suffix = timeline[match.end() : match.end() + 16]
    if re.match(r"\s*(?:st|nd|rd|th)\b(?:\s+century)?", suffix, re.IGNORECASE):
        year = (year - 1) * 100
    if "bc" in timeline[: match.end() + 24].lower() or "bce" in timeline[: match.end() + 24].lower():
        year = -year
    return year


def normalize_cala_records(document):
    """Normalize period or event Cala records without losing provenance."""
    records = document.get("results")
    if not isinstance(records, list) or not records:
        raise ValueError("Knowledge-search JSON must contain a non-empty results array")
    normalized = []
    for index, item in enumerate(records):
        event = (item.get("event") or item.get("fact") or "").strip()
        timeline = (item.get("timeline") or "").strip()
        if not event or not timeline or timeline_year(timeline) is None:
            continue
        normalized.append({
            "source_index": index,
            "event": event,
            "timeline": timeline,
            "title": (item.get("title") or "").strip(),
            "source_url": (item.get("source_url") or "").strip(),
            "entities": item.get("entities") or [],
            "sort_year": timeline_year(timeline),
        })
    if not normalized:
        raise ValueError("Knowledge-search JSON has no dated, usable records")
    return sorted(normalized, key=lambda record: (record["sort_year"], record["source_index"]))


def story_schema(expected_count=6):
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["era_label", "era_rationale", "events"],
        "properties": {
            "era_label": {"type": "string"},
            "era_rationale": {"type": "string"},
            "events": {
                "type": "array",
                "minItems": expected_count,
                "maxItems": expected_count,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["source_indices", "year", "event_title", "fact_text", "narrative_copy", "visual_brief"],
                    "properties": {
                        "source_indices": {"type": "array", "minItems": 1, "items": {"type": "integer"}},
                        "year": {"type": "integer"},
                        "event_title": {"type": "string"},
                        "fact_text": {"type": "string"},
                        "narrative_copy": {"type": "string"},
                        "visual_brief": {"type": "string"},
                    },
                },
            },
        },
    }


def build_curator_input(country_name, candidates, expected_count=6):
    source_lines = []
    for record in candidates:
        source_lines.append(json.dumps({
            "source_index": record["source_index"],
            "timeline": record["timeline"],
            "event": record["event"],
            "title": record["title"],
            "source_url": record["source_url"],
        }, ensure_ascii=False))
    return (
        f"Create a {expected_count}-moment chronological historical journey for {country_name}. "
        "Select only dated, distinct source records. Every claim in fact_text and narrative_copy must be "
        "supported by the referenced source_indices; do not invent names, dates, causes, or outcomes. "
        "Use a cinematic-museum voice: evocative but restrained. visual_brief must describe architecture, "
        "artifacts, landscapes, maps, textiles, or ships; avoid identifiable people, captions, and spectacle. "
        "Return exactly the requested JSON schema.\n\nCandidates:\n" + "\n".join(source_lines)
    )


def validate_story(events, candidates, expected_count=6):
    """Validate source linkage, uniqueness, and chronological order from GPT output."""
    if len(events) != expected_count:
        raise ValueError(f"Story must contain exactly {expected_count} events")
    available = {record["source_index"] for record in candidates}
    candidates_by_index = {record["source_index"]: record for record in candidates}
    seen_sources = set()
    seen_titles = set()
    prior_year = None
    validated = []
    for event in events:
        required = {"source_indices", "year", "event_title", "fact_text", "narrative_copy", "visual_brief"}
        if not required.issubset(event) or not isinstance(event["source_indices"], list) or not event["source_indices"]:
            raise ValueError("Story event is missing required fields")
        source_indices = set(event["source_indices"])
        if not source_indices.issubset(available):
            raise ValueError("Story event references an unknown source")
        if seen_sources.intersection(source_indices):
            raise ValueError("Story events must use distinct source records")
        if not isinstance(event["year"], int):
            raise ValueError("Story event year must be an integer")
        if event["year"] not in {candidates_by_index[index]["sort_year"] for index in source_indices}:
            raise ValueError("Story event year must match a referenced source timeline")
        title_key = event["event_title"].strip().lower()
        if not title_key or title_key in seen_titles:
            raise ValueError("Story events must have distinct titles")
        if prior_year is not None and event["year"] < prior_year:
            raise ValueError("Story events must be chronological")
        seen_sources.update(source_indices)
        seen_titles.add(title_key)
        prior_year = event["year"]
        validated.append(event)
    return validated


def event_id(order, title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "event"
    return slug


def deterministic_seed(country_code, event_identifier, profile_version):
    digest = hashlib.sha256(f"{country_code}:{event_identifier}:{profile_version}".encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 2147483647


def build_fal_prompt(event, profile):
    constraints = "; ".join(profile["constraints"])
    return (
        f"Museum-editorial historical illustration. Visual brief: {event['visual_brief']} "
        f"Style: {profile['style']}. Required constraints: {constraints}."
    )


def build_frontend_story(country_code, country_name, curated, candidates, profile):
    candidates_by_index = {record["source_index"]: record for record in candidates}
    events = validate_story(curated["events"], candidates)
    moments = []
    for order, event in enumerate(events, start=1):
        identifier = event_id(order, event["event_title"])
        sources = [candidates_by_index[index] for index in event["source_indices"]]
        moments.append({
            "id": identifier,
            "year": event["year"],
            "orderIndex": order - 1,
            "factText": event["fact_text"],
            "sourceRef": "; ".join(filter(None, [source["title"] for source in sources])) or "Cala knowledge search",
            "sourceIndices": event["source_indices"],
            "narrativeCopy": event["narrative_copy"],
            "visualBrief": event["visual_brief"],
            "imagePath": f"/moments/{country_code.lower()}/{order:02d}-{identifier}.jpg",
            "styleProfile": profile["version"],
        })
    return {
        "code": country_code.upper(),
        "name": country_name,
        "eraLabel": curated["era_label"],
        "eraStartYear": moments[0]["year"],
        "eraEndYear": moments[-1]["year"],
        "eraRationale": curated["era_rationale"],
        "moments": moments,
    }


def scrub_secrets(value):
    if isinstance(value, dict):
        return {key: scrub_secrets(child) for key, child in value.items() if key.lower() not in SENSITIVE_KEYS}
    if isinstance(value, list):
        return [scrub_secrets(child) for child in value]
    return value


def append_fal_log(log_path, run):
    """Append a safe generation record without ever persisting credentials."""
    log_path = Path(log_path)
    payload = {"runs": []}
    if log_path.exists():
        payload = json.loads(log_path.read_text(encoding="utf-8"))
    payload.setdefault("runs", []).append({"generated_at": datetime.now(timezone.utc).isoformat(), **scrub_secrets(run)})
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
