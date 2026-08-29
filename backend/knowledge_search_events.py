#!/usr/bin/env python3
"""
Runs a Cala knowledge_search query for historical events and saves results as JSON,
sorted chronologically by the earliest year mentioned in each event.

Each output record captures:
  - event: the full claim text from Cala's explainability trace
  - timeline: the date/year/era range mentioned in the event text (parenthesized,
              e.g. "(1701-1715)", or inline, e.g. "in 1609" -> "1609")
  - title: the title of the cited source document, resolved from Cala's provenance
           chain (explainability[i].references -> context[j].id -> origins[k].document.name),
           falling back to the publisher name, then "".
  - source_url: the cited source document's URL, from the same provenance chain as title
  - entities: Cala's own typed entities (people, places, events, laws, ...) that are
              mentioned in this specific event's text, as [{name, entity_type}, ...]

Records are sorted by the earliest year found in "timeline" (ascending); events with
no date at all are placed first.

Usage:
  Put CALA_API_KEY=your-key in a .env file at the project root, then:
  python3 backend/knowledge_search_events.py "What are the most significant historical events in Spain's history?"
"""

import argparse
import json
import os
import re
import sys

from cala_client import call_knowledge_search, context_by_id, load_dotenv, resolve_source

# A parenthesized date/era range, e.g. "(c. 50,000 BC - 1,100 BC)" or "(711-1492)".
PARENTHESIZED_TIMELINE_PATTERN = re.compile(
    r"\(([^()]*?\b(?:BC|AD|century|present)?[^()]*?\d[^()]*?)\)"
)

# A bare year or year range mentioned inline, not in parentheses, e.g. "in 1609",
# "1701-1715", "in 1519". Requires a 3-4 digit number so it doesn't match stray digits.
INLINE_YEAR_RANGE_PATTERN = re.compile(r"\b(\d{3,4}(?:\s*[-‐-―]\s*\d{3,4})?)\b")

YEAR_PATTERN = re.compile(r"\d{3,4}")


def extract_timeline(text: str) -> str:
    """Extracts a date/era range from event text: prefers a parenthesized range,
    falls back to a bare inline year or year range."""
    match = PARENTHESIZED_TIMELINE_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    match = INLINE_YEAR_RANGE_PATTERN.search(text)
    return match.group(1).strip() if match else ""


def earliest_year(timeline: str) -> int:
    """Parses the earliest year out of a timeline string for sorting. Returns None
    when no year can be found (so callers can sort undated events separately)."""
    if not timeline:
        return None
    years = [int(y) for y in YEAR_PATTERN.findall(timeline)]
    if not years:
        return None
    year = min(years)
    if re.search(r"\bBC\b", timeline, re.IGNORECASE):
        year = -year
    return year


def resolve_entities(text: str, all_entities: list) -> list:
    """Returns the subset of Cala's returned entities that are mentioned in this
    specific event's text, as [{name, entity_type}, ...]."""
    matches = []
    lowered = text.lower()
    for entity in all_entities:
        for mention in entity.get("mentions") or []:
            if mention and mention.lower() in lowered:
                matches.append({
                    "name": entity.get("name", mention),
                    "entity_type": entity.get("entity_type", ""),
                })
                break
    return matches


def build_records(tool_output: dict) -> list:
    """Turns Cala's explainability entries into event/timeline/title/source_url/entities
    records, sorted chronologically (earliest year first; undated events first)."""
    context_index = context_by_id(tool_output)
    all_entities = tool_output.get("entities") or []

    records = []
    for item in tool_output.get("explainability", []):
        event_text = item.get("content", "")
        references = item.get("references", [])
        title, source_url = resolve_source(references, context_index)
        timeline = extract_timeline(event_text)
        records.append(
            {
                "event": event_text,
                "timeline": timeline,
                "title": title,
                "source_url": source_url,
                "entities": resolve_entities(event_text, all_entities),
                "_sort_year": earliest_year(timeline),
            }
        )

    records.sort(key=lambda r: (r["_sort_year"] is not None, r["_sort_year"] or 0))
    for record in records:
        del record["_sort_year"]
    return records


def main():
    parser = argparse.ArgumentParser(description="Run a Cala knowledge_search for historical events and save results as JSON.")
    parser.add_argument(
        "query",
        nargs="?",
        default="What are the most significant historical events in Spain's history?",
        help="Natural language query to send to Cala's knowledge_search tool.",
    )
    parser.add_argument(
        "-o", "--output",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "knowledge-search-spain-2.json"),
        help="Path to write the resulting JSON file.",
    )
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    api_key = os.environ.get("CALA_API_KEY")
    if not api_key:
        print("Error: set CALA_API_KEY in the project's .env file before running this script.", file=sys.stderr)
        sys.exit(1)

    try:
        tool_output = call_knowledge_search(args.query, api_key)
        records = build_records(tool_output)
    except Exception as exc:
        print(f"Error running Cala knowledge search: {exc}", file=sys.stderr)
        sys.exit(1)

    output = {
        "query": args.query,
        "results": records,
    }

    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(records)} records to {output_path}")


if __name__ == "__main__":
    main()
