#!/usr/bin/env python3
"""
Builds an encyclopedia of people and places from the entities already resolved in a
knowledge-search-events JSON file (see knowledge_search_events.py).

For each unique entity mentioned across the input events:
  1. entity_search  - resolve the entity's Cala UUID (disambiguated by entity_type).
  2. entity_introspection - discover what properties/relationships are queryable.
  3. entity_retrieval - project exactly what introspection found.
  4. Quality gate: if that profile is thin (no relationships, no properties beyond
     name/description/aliases), fall back to a targeted knowledge_search query
     ("Who was X and what was their role in <country>'s history?") to get a real
     sourced biography instead of a one-line stub.

Output is two buckets - "people" and "places" - each entry carrying either a
structured Cala profile or a sourced enriched_fact with citations, never a bare stub
alone. Entities of other types (Event, Law, Organization, Product, ...) are skipped;
they're already represented by the events themselves.

Usage:
  Put CALA_API_KEY=your-key in a .env file at the project root, then:
  python3 backend/generate_encyclopedia.py data/knowledge-search-spain-2.json -o data/encyclopedia-spain.json
"""

import argparse
import json
import os
import re
import sys

from cala_client import (
    call_entity_introspection,
    call_entity_retrieval,
    call_entity_search,
    call_knowledge_search,
    context_by_id,
    load_dotenv,
    resolve_source,
)

YEAR_PATTERN = re.compile(r"\d{3,4}")


def timeline_years(timeline: str) -> list:
    """Parses all years mentioned in a timeline string (e.g. "1701-1715" -> [1701, 1715]),
    negated for BC. Returns [] when no year can be found."""
    if not timeline:
        return []
    years = [int(y) for y in YEAR_PATTERN.findall(timeline)]
    if not years:
        return []
    if re.search(r"\bBC\b", timeline, re.IGNORECASE):
        years = [-y for y in years]
    return years

PEOPLE_TYPES = {"Person"}
PLACE_TYPES = {"GPE", "Country", "CountrySubdivision", "Municipality", "Location", "CountryRegion"}

# Properties considered "thin" - present on virtually every entity regardless of how
# well-documented it is - so their presence alone doesn't count as a rich profile.
BASELINE_PROPERTIES = {"name", "description", "id", "aliases"}


def dedupe_entities(events: list) -> list:
    """Collects unique {name, entity_type} entities mentioned across all events, plus
    which event(s) each one was mentioned in and the years of those events (used to
    sanity-check retrieved profiles against when this entity was actually relevant,
    rather than one fixed era - our events can span many centuries)."""
    by_key = {}
    for event in events:
        event_label = event.get("event", "")
        event_years = timeline_years(event.get("timeline", ""))
        for entity in event.get("entities") or []:
            name = entity.get("name", "").strip()
            entity_type = entity.get("entity_type", "").strip()
            if not name or not entity_type:
                continue
            key = (name, entity_type)
            if key not in by_key:
                by_key[key] = {"name": name, "entity_type": entity_type, "mentioned_in_events": [], "event_years": []}
            if event_label and event_label not in by_key[key]["mentioned_in_events"]:
                by_key[key]["mentioned_in_events"].append(event_label)
            by_key[key]["event_years"].extend(event_years)
    return list(by_key.values())


def resolve_entity_id(name: str, entity_type: str, api_key: str) -> str:
    """Resolves a Cala entity UUID for (name, entity_type), preferring an exact
    case-insensitive name match among same-typed results."""
    matches = call_entity_search(name, api_key, entity_types=[entity_type], limit=5)
    if not matches:
        return None
    for match in matches:
        if match.get("name", "").strip().lower() == name.strip().lower():
            return match.get("id")
    return matches[0].get("id")


def is_thin_profile(properties: dict, relationships: dict) -> bool:
    """A profile is thin if it has no relationships and no properties beyond the
    baseline ones every entity carries."""
    has_relationships = bool(relationships.get("incoming")) or bool(relationships.get("outgoing"))
    extra_properties = set(properties.keys()) - BASELINE_PROPERTIES
    return not has_relationships and not extra_properties


def property_value(properties: dict, key: str):
    """Cala returns retrieved properties as {value, sources}; unwrap to the plain value."""
    entry = properties.get(key)
    if isinstance(entry, dict) and "value" in entry:
        return entry["value"]
    return entry


def is_implausible_profile(name: str, properties: dict, event_years: list, margin_years: int = 100) -> bool:
    """Flags a retrieved profile as an unreliable match when its own data contradicts
    the specific event(s) this entity was actually mentioned in - catches cases where
    Cala has merged two unrelated real-world entities under one id (verified to
    happen: an entity named "Miguel de Cervantes Saavedra" whose aliases also
    included "Nemesio Oseguera Cervantes" - a modern, unrelated person - and whose
    description named both).

    Compares birth_date against the years of THIS entity's own mentioned events, not
    a fixed era - a person's birth can reasonably precede or follow the events they're
    associated with by margin_years (their life, or their later legacy/commemoration),
    but not by centuries. An alias that looks like an unrelated modern name (shares
    less than half its words with the entity's own name) corroborates a mismatch."""
    birth_date = property_value(properties, "birth_date")
    birth_year = None
    if birth_date and event_years:
        try:
            birth_year = int(str(birth_date)[:4])
        except ValueError:
            birth_year = None
        if birth_year is not None:
            closest_gap = min(abs(birth_year - year) for year in event_years)
            if closest_gap > margin_years:
                return True

    aliases = property_value(properties, "aliases") or []
    name_words = set(name.lower().split())
    for alias in aliases:
        alias_words = set(str(alias).lower().split())
        if len(alias_words) < 2:
            continue
        # A real name variant shares most of its words with the entity's own name
        # (e.g. "Francisco Franco" vs "Francisco Franco Bahamonde"); an unrelated
        # person's full name sharing only an incidental single word (e.g. a common
        # surname like "Cervantes") does not.
        overlap = alias_words & name_words
        if len(overlap) / len(alias_words) < 0.5:
            return True
    return False


RELATIONSHIP_LIMIT_PER_TYPE = 5


def slim_related_entity(related: dict) -> dict:
    """Trims a related entity down to just what an encyclopedia entry needs -
    name and type - dropping its own nested properties/sources, which is where
    the payload explodes (one relationship can carry dozens of citations)."""
    return {
        "id": related.get("id", ""),
        "name": related.get("name", ""),
        "entity_type": related.get("entity_type", ""),
    }


def retrieve_profile(entity_id: str, api_key: str) -> tuple:
    """Introspects an entity then retrieves a projection of everything introspection
    found queryable. Returns (properties, relationships) with property values unwrapped
    from Cala's {value, sources} shape to plain values, and each relationship capped
    at RELATIONSHIP_LIMIT_PER_TYPE, slimmed to {id, name, entity_type}."""
    schema = call_entity_introspection(entity_id, api_key)
    queryable_properties = schema.get("properties") or []
    queryable_relationships = schema.get("relationships") or {}

    relationship_projection = {}
    if queryable_relationships.get("incoming"):
        relationship_projection["incoming"] = {
            rel: {"limit": RELATIONSHIP_LIMIT_PER_TYPE} for rel in queryable_relationships["incoming"]
        }
    if queryable_relationships.get("outgoing"):
        relationship_projection["outgoing"] = {
            rel: {"limit": RELATIONSHIP_LIMIT_PER_TYPE} for rel in queryable_relationships["outgoing"]
        }

    profile = call_entity_retrieval(
        entity_id,
        api_key,
        properties=queryable_properties or None,
        relationships=relationship_projection or None,
    )
    raw_properties = profile.get("properties") or {}
    properties = {key: property_value(raw_properties, key) for key in raw_properties}

    raw_relationships = profile.get("relationships") or {}
    relationships = {}
    for direction in ("incoming", "outgoing"):
        by_type = raw_relationships.get(direction) or {}
        if by_type:
            relationships[direction] = {
                rel_type: [slim_related_entity(r) for r in related_list[:RELATIONSHIP_LIMIT_PER_TYPE]]
                for rel_type, related_list in by_type.items()
            }
    return properties, relationships


def enrich_via_knowledge_search(name: str, entity_type: str, country: str, api_key: str) -> dict:
    """Falls back to a targeted knowledge_search query for a thin entity, returning
    a sourced paragraph with citations - the same provenance model used everywhere
    else in this pipeline."""
    subject = "What is" if entity_type not in PEOPLE_TYPES else "Who was"
    query = f"{subject} {name} and what was their role in {country}'s history?"
    tool_output = call_knowledge_search(query, api_key)
    context_index = context_by_id(tool_output)

    claims = []
    for item in tool_output.get("explainability", []):
        content = item.get("content", "")
        if not content:
            continue
        title, source_url = resolve_source(item.get("references", []), context_index)
        claims.append({"claim": content, "title": title, "source_url": source_url})

    return {
        "summary": tool_output.get("content", ""),
        "claims": claims,
    }


def build_entry(entity: dict, country: str, api_key: str) -> dict:
    """Builds one encyclopedia entry: resolve -> introspect -> retrieve, falling back
    to knowledge_search when the retrieved profile is thin OR implausible given the
    entity's own mentioned events (e.g. Cala has merged this entity with an unrelated
    real-world figure)."""
    name = entity["name"]
    entity_type = entity["entity_type"]
    event_years = entity.get("event_years") or []

    entry = {
        "name": name,
        "entity_type": entity_type,
        "description": "",
        "properties": {},
        "relationships": {},
        "enriched_fact": None,
        "mentioned_in_events": entity["mentioned_in_events"],
    }

    entity_id = resolve_entity_id(name, entity_type, api_key)
    use_retrieved_profile = False
    if entity_id:
        properties, relationships = retrieve_profile(entity_id, api_key)
        if is_implausible_profile(name, properties, event_years):
            print(f"    warning: discarding implausible Cala profile for {name!r} "
                  f"(id {entity_id}) - falling back to knowledge_search")
        else:
            entry["properties"] = properties
            entry["relationships"] = relationships
            entry["description"] = properties.get("description", "")
            use_retrieved_profile = True

    if not use_retrieved_profile or is_thin_profile(entry["properties"], entry["relationships"]):
        entry["enriched_fact"] = enrich_via_knowledge_search(name, entity_type, country, api_key)
        if not entry["description"]:
            entry["description"] = summarize_markdown(entry["enriched_fact"]["summary"])

    return entry


def build_encyclopedia(events: list, country: str, api_key: str) -> dict:
    people, places = [], []
    for entity in dedupe_entities(events):
        entity_type = entity["entity_type"]
        if entity_type not in PEOPLE_TYPES and entity_type not in PLACE_TYPES:
            continue
        entry = build_entry(entity, country, api_key)
        (people if entity_type in PEOPLE_TYPES else places).append(entry)
        print(f"  {entity_type}: {entity['name']}"
              f"{' (enriched via knowledge_search)' if entry['enriched_fact'] else ''}")
    return {"people": people, "places": places}


def main():
    parser = argparse.ArgumentParser(description="Build a people/places encyclopedia from a knowledge-search-events JSON file.")
    parser.add_argument("input", help="Path to a knowledge_search_events.py output JSON file.")
    parser.add_argument("-o", "--output", required=True, help="Path to write the resulting JSON file.")
    parser.add_argument("--country", default="Spain", help="Country name, used to phrase the enrichment fallback query.")
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    api_key = os.environ.get("CALA_API_KEY")
    if not api_key:
        print("Error: set CALA_API_KEY in the project's .env file before running this script.", file=sys.stderr)
        sys.exit(1)

    input_path = os.path.abspath(args.input)
    with open(input_path, "r", encoding="utf-8") as f:
        document = json.load(f)
    events = document.get("results") or []
    if not events:
        print(f"Error: {input_path} has no results to read entities from.", file=sys.stderr)
        sys.exit(1)

    try:
        encyclopedia = build_encyclopedia(events, args.country, api_key)
    except Exception as exc:
        print(f"Error building encyclopedia: {exc}", file=sys.stderr)
        sys.exit(1)

    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(encyclopedia, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(encyclopedia['people'])} people and {len(encyclopedia['places'])} places to {output_path}")


if __name__ == "__main__":
    main()
