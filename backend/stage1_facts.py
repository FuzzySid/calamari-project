#!/usr/bin/env python3
"""Stage 1 of the country pipeline: retrieve dated historical events from Cala.

Queries Cala's `knowledge_search` MCP tool over raw HTTP JSON-RPC, turns each
explainability entry into a structured event (title, description, timeline,
sources, entities) and writes them to `<output-root>/<country-slug>/info.json`.

Every claim is traceable: `event_text` is Cala's raw text, `sources` are resolved
through Cala's provenance chain (explainability -> context -> origins), and no
date is ever invented. Events Cala returns without a parseable date are dropped,
since Stage 2 and Stage 3 key off the chronology.

Standard library only.

Usage:
  Put CALA_API_KEY in a .env file at the project root, then:
  python3 backend/stage1_facts.py --country Portugal
  python3 backend/stage1_facts.py --country Japan --limit 8 --query "..."
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline_common import (
    country_paths,
    load_dotenv,
    require_env,
    slugify,
    utc_now_iso,
    write_json,
)

CALA_MCP_URL = "https://api.cala.ai/mcp/"

# A parenthesized date/era range, e.g. "(c. 50,000 BC - 1,100 BC)" or "(711-1492)".
PARENTHESIZED_TIMELINE_PATTERN = re.compile(
    r"\(([^()]*?\b(?:BC|AD|century|present)?[^()]*?\d[^()]*?)\)"
)

# A bare year or year range mentioned inline, e.g. "in 1609", "1701-1715".
# Requires 3-4 digits so stray numbers do not match. The lookarounds reject digits sitting
# inside a comma-grouped figure, so "30,000 men" never yields the year "000".
INLINE_YEAR_RANGE_PATTERN = re.compile(
    r"(?<![\d,])(\d{3,4}(?:\s*[-‐-―]\s*\d{3,4})?)(?!\s*,?\d)"
)

# A comma-grouped year is only read as a year when BC follows it, e.g. "50,000 BC".
# Without that anchor "30,000 men" would be mistaken for a year. The trailing BC is optional
# so the second half of "50,000 BC - 1,100 BC" is captured even when written "- 1,100".
BC_MAGNITUDE_PATTERN = re.compile(
    r"(\d{1,3}(?:,\d{3})+)\s*(?:BC\b)?(?:\s*[-‐-―]\s*(\d{1,3}(?:,\d{3})+)\s*(?:BC\b)?)?",
    re.IGNORECASE,
)

# Only treat comma-grouped figures as years when the text actually says BC somewhere.
BC_MARKER_PATTERN = re.compile(r"\bBC\b", re.IGNORECASE)

YEAR_PATTERN = re.compile(r"\d{3,4}")

# A markdown section heading in Cala's narrative, e.g. "### 1. The Reconquista (711-1492)".
# Level 3+ only: level 2 is the document's own title, not an event.
NARRATIVE_HEADING_PATTERN = re.compile(r"^#{3,}\s+(.*\S)\s*$")

# Ordinal centuries, e.g. the "8th" and "15th" of "8th-15th centuries".
ORDINAL_CENTURY_PATTERN = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)\b")

# A century range stated outside parentheses: "8th-15th centuries", "9th century", and the
# spelled-out "9th to the 12th centuries" form, whose ordinals are not adjacent.
CENTURY_RANGE_PATTERN = re.compile(
    r"\b\d{1,2}(?:st|nd|rd|th)\s*"
    r"(?:(?:[-‐-―]|\s+to\s+(?:the\s+)?)\s*\d{1,2}(?:st|nd|rd|th)\s*)?"
    r"centur(?:y|ies)\b",
    re.IGNORECASE,
)

# Date fields Cala may attach to a document or origin. Absence means null — a
# publication date is never guessed from the claim text.
DATE_FIELDS = ("date", "published_at", "publication_date", "created_at", "published")

# Document names often arrive as "Page Title | Site | Section"; the first segment
# is the usable part.
TITLE_SEPARATORS = re.compile(r"\s*[|–—]\s*|\s+-\s+")

# Cala states each claim as "<the event> is|are <verb> in|among|by the ... fact".
# Splitting on that hinge recovers the event without the boilerplate tail.
TITLE_TAIL_PATTERN = re.compile(
    r",?\s+(?:which|that)?\s*(?:is|are|was|were)\s+\w+\s+(?:in|among|by|as)\b"
)

MAX_TITLE_LENGTH = 80
MAX_ID_LENGTH = 60

# Dropped from event ids so the length budget goes to distinguishing words.
ID_STOPWORDS = {"the", "a", "an", "of", "and", "in", "to", "its", "is", "are", "with"}


def call_cala(query, api_key):
    """POST knowledge_search to Cala and unwrap the tool output.

    Kept local rather than using `request_json` because this endpoint may answer
    as SSE, and the payload is buried three layers deep: SSE frame -> JSON-RPC
    envelope -> a `content[]` text block holding the tool's own JSON.
    """
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "knowledge_search",
            "arguments": {
                "input": query,
                "explainability": True,
                "return_entities": True,
            },
        },
    }
    request = urllib.request.Request(
        CALA_MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-API-KEY": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        body = response.read().decode("utf-8")

    if body.lstrip().startswith("event:"):
        data_lines = [
            line[len("data:") :].strip()
            for line in body.splitlines()
            if line.startswith("data:")
        ]
        body = data_lines[-1] if data_lines else body

    envelope = json.loads(body)
    if envelope.get("error"):
        raise RuntimeError(f"Cala MCP error: {envelope['error']}")
    result = envelope["result"]

    for block in result.get("content") or []:
        if block.get("type") == "text":
            return json.loads(block["text"])
    raise RuntimeError("No text content block found in Cala MCP response")


def extract_timeline(text):
    """Extract the raw date range text: parenthesized range, then inline year, then century.

    The century fallback comes last so an explicit year always wins, but it keeps events
    dated only as "8th-15th centuries" from being dropped as undated.
    """
    match = PARENTHESIZED_TIMELINE_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    if BC_MARKER_PATTERN.search(text):
        match = BC_MAGNITUDE_PATTERN.search(text)
        if match:
            return match.group(0).strip()
    match = INLINE_YEAR_RANGE_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    match = CENTURY_RANGE_PATTERN.search(text)
    return match.group(0).strip() if match else ""


def year_bounds(timeline):
    """(earliest, latest) years in a timeline string, negated for BC. (None, None) if undated."""
    if not timeline:
        return None, None
    if BC_MARKER_PATTERN.search(timeline) and BC_MAGNITUDE_PATTERN.search(timeline):
        # "50,000 BC - 1,100 BC": read the comma-grouped magnitudes, not their fragments.
        years = [
            int(group.replace(",", ""))
            for match in BC_MAGNITUDE_PATTERN.finditer(timeline)
            for group in match.groups()
            if group
        ]
    else:
        years = [int(year) for year in YEAR_PATTERN.findall(timeline)]
    if not years:
        # Era phrasing carries no explicit year: "8th-15th centuries" is a real date range
        # and must not be discarded as undated. Nth century -> its first year (8th -> 701).
        years = [(int(n) - 1) * 100 + 1 for n in ORDINAL_CENTURY_PATTERN.findall(timeline)]
    if not years:
        return None, None
    if re.search(r"\bBC\b", timeline, re.IGNORECASE):
        years = [-year for year in years]
    return min(years), max(years)


def build_timeline(text):
    """Structured timeline for an event, or None when no date can be parsed."""
    display = extract_timeline(text)
    start, end = year_bounds(display)
    if start is None:
        return None
    return {"start": str(start), "end": str(end), "display": display}


def resolve_sources(references, context_by_id):
    """Every distinct cited source for a claim, walking Cala's full provenance chain.

    One entry per distinct URL in citation order. `date` stays null unless Cala
    actually supplies one — a source date is never inferred.
    """
    sources = []
    seen_urls = set()
    for reference_id in references:
        context = context_by_id.get(reference_id)
        if not context:
            continue
        for origin in context.get("origins") or []:
            record = origin.get("document") or origin.get("source") or {}
            url = record.get("url") or ""
            if not record.get("name") and not url:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append(
                {
                    "publisher": record.get("name") or "",
                    "url": url,
                    "date": find_date(record, origin),
                }
            )
    return sources


def find_date(record, origin):
    """First date field Cala supplies on the document or its origin, else None."""
    for container in (record, origin):
        for field in DATE_FIELDS:
            value = container.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def resolve_entities(text, all_entities):
    """Cala's typed entities whose mentions appear in this event's text."""
    matches = []
    lowered = text.lower()
    for entity in all_entities:
        for mention in entity.get("mentions") or []:
            if mention and mention.lower() in lowered:
                matches.append(
                    {
                        "name": entity.get("name", mention),
                        "entity_type": entity.get("entity_type", ""),
                    }
                )
                break
    return matches


def narrative_headings(content):
    """Event names from the markdown narrative Cala returns alongside the claims.

    The narrative is written as "### 1. The Reconquista (711-1492)", which names the event
    far better than either a source headline or the opening clause of a claim. Returns
    headings in document order, stripped of numbering and any trailing date parenthetical.
    """
    headings = []
    for line in (content or "").splitlines():
        match = NARRATIVE_HEADING_PATTERN.match(line.strip())
        if not match:
            continue
        heading = match.group(1).strip()
        heading = re.sub(r"^\d+[.)]\s*", "", heading).strip()
        heading = re.sub(r"\s*\([^()]*\d[^()]*\)\s*$", "", heading).strip()
        if heading:
            headings.append(heading)
    return headings


def heading_score(event_text, heading):
    """Fraction of a heading's significant words that appear in the claim text."""
    words = [w for w in re.findall(r"[a-z]{4,}", heading.lower()) if w not in ID_STOPWORDS]
    if not words:
        return 0.0
    lowered = event_text.lower()
    return sum(1 for word in words if word in lowered) / len(words)


def match_heading(event_text, headings, position=None):
    """The narrative heading naming this claim.

    Cala emits claims and headings in the same order, so the heading at the claim's own
    position is preferred whenever it plausibly matches. Keyword overlap alone is not
    enough: a claim can open by referring to the *previous* event ("After the completion
    of the Reconquista, Ferdinand and Isabella financed Columbus...") and would otherwise
    be titled with that earlier heading.
    """
    if position is not None and position < len(headings):
        candidate = headings[position]
        if heading_score(event_text, candidate) > 0.3:
            return candidate

    best, best_score = "", 0.0
    for heading in headings:
        score = heading_score(event_text, heading)
        if score > best_score:
            best, best_score = heading, score
    # Over half the heading's significant words must appear, so a weak overlap
    # never mislabels an event.
    return best if best_score > 0.5 else ""


def build_title(event_text, sources, shared_publishers=(), headings=(), position=None):
    """A short human title for the event.

    Preference order: the narrative heading (a real event name), then the claim's opening
    clause, then a source document name. Document names come last because they are article
    headlines -- "How Elizabethan England repelled the 'invincible' Spanish Armada" names
    the source, not the event, and would leak into event ids and Stage 2's prompts.
    """
    heading = match_heading(event_text, headings, position)
    if heading:
        return heading
    title = event_title_from_text(event_text)
    if title:
        return title
    for source in sources:
        publisher = source.get("publisher") or ""
        if publisher in shared_publishers:
            continue
        candidate = TITLE_SEPARATORS.split(publisher)[0].strip()
        if len(candidate) > 3 and not candidate.isdigit():
            return candidate
    return ""


def event_title_from_text(event_text):
    """The event's opening clause, with Cala's "... is recorded in the fact" tail trimmed.

    Cala phrases each claim as "<the event> is/are <recorded|noted|...> in the fact",
    so cutting at that hinge leaves the event itself.
    """
    text = event_text.strip().rstrip(".")
    text = TITLE_TAIL_PATTERN.split(text, maxsplit=1)[0]
    clause = re.split(r"[,;:]", text, maxsplit=1)[0].strip()
    if len(clause) < 12:
        clause = text.strip()
    return truncate_words(clause, MAX_TITLE_LENGTH) or event_text[:60].strip()


def truncate_words(text, limit):
    """Trim to `limit` characters without cutting a word in half."""
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].strip().rstrip(",;:-")


def build_description(event_text):
    """First one or two sentences of Cala's claim text — a summary, never a new claim."""
    sentences = re.split(r"(?<=[.!?])\s+", event_text.strip())
    return " ".join(sentences[:2]).strip()


def build_event_id(title, event_text, start_year, used_ids):
    """Stable underscore id joining Stage 1 to Stages 2 and 3, e.g. `reconquista_1492`.

    The year suffix keeps ids distinct when two events share an opening phrase; a
    numeric suffix breaks any remaining tie so a run never emits a duplicate key.
    """
    slug = slugify(title) or slugify(event_text[:60]) or "event"
    words = [word for word in slug.split("-") if word and word not in ID_STOPWORDS]
    stem = truncate_words(" ".join(words) or slug.replace("-", " "), MAX_ID_LENGTH)
    base = f"{stem.replace(' ', '_').strip('_')}_{start_year}"
    event_id = base
    suffix = 2
    while event_id in used_ids:
        event_id = f"{base}_{suffix}"
        suffix += 1
    used_ids.add(event_id)
    return event_id


def build_events(tool_output, limit):
    """Dated events sorted oldest-first and truncated to `limit`, plus the pre-truncation count."""
    context_by_id = {
        context["id"]: context
        for context in tool_output.get("context") or []
        if "id" in context
    }
    all_entities = tool_output.get("entities") or []
    explainability = tool_output.get("explainability") or []

    dated = []
    for index, item in enumerate(explainability):
        event_text = item.get("content", "")
        timeline = build_timeline(event_text)
        if timeline is None:
            # Undated entries (e.g. bare country-description facts) have no place
            # in a chronological story.
            continue
        sources = resolve_sources(item.get("references") or [], context_by_id)
        dated.append(
            {
                # Narrative position, kept so a claim can be matched to its own heading
                # even after the chronological sort reorders the list.
                "position": index,
                "sort_year": int(timeline["start"]),
                "description": build_description(event_text),
                "timeline": timeline,
                "sources": sources,
                "entities": resolve_entities(event_text, all_entities),
                "event_text": event_text,
            }
        )

    dated.sort(key=lambda event: event["sort_year"])

    # Titling needs the whole set: a publisher cited by more than one event names
    # the source, not the event.
    publisher_counts = {}
    for event in dated:
        for publisher in {source["publisher"] for source in event["sources"]}:
            publisher_counts[publisher] = publisher_counts.get(publisher, 0) + 1
    shared_publishers = {name for name, count in publisher_counts.items() if count > 1}
    headings = narrative_headings(tool_output.get("content"))
    for event in dated:
        event["title"] = build_title(
            event["event_text"], event["sources"], shared_publishers, headings,
            event["position"],
        )

    used_ids = set()
    events = []
    for event in dated[:limit]:
        sort_year = event.pop("sort_year")
        events.append(
            {
                "id": build_event_id(event["title"], event["event_text"], sort_year, used_ids),
                "title": event["title"],
                "description": event["description"],
                "timeline": event["timeline"],
                "sources": event["sources"],
                "entities": event["entities"],
                "event_text": event["event_text"],
            }
        )
    return events, len(explainability)


def main():
    parser = argparse.ArgumentParser(
        description="Stage 1: retrieve dated historical events for a country from Cala."
    )
    parser.add_argument("--country", required=True, help="Country name, e.g. Portugal.")
    parser.add_argument("--query", help="Override the default knowledge_search query.")
    parser.add_argument("--limit", type=int, default=5, help="Maximum events to keep (default 5).")
    parser.add_argument("--output-root", default=None, help="Override the pipeline output root.")
    args = parser.parse_args()

    query = args.query or f"five most notable events in {args.country} history"

    try:
        load_dotenv()
        api_key = require_env("CALA_API_KEY")
        paths = country_paths(args.country, args.output_root)
        tool_output = call_cala(query, api_key)
        events, total_returned = build_events(tool_output, args.limit)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    if len(events) < args.limit:
        print(
            f"WARNING: only {len(events)} dated events found for {args.country}, "
            f"requested {args.limit}",
            file=sys.stderr,
        )

    write_json(
        paths["info"],
        {
            "country": args.country,
            "country_slug": paths["slug"],
            "query": query,
            "generated_at": utc_now_iso(),
            "total_returned": total_returned,
            "events": events,
        },
    )
    print(f"Wrote {len(events)} events to {paths['info']}")


if __name__ == "__main__":
    main()
