#!/usr/bin/env python3
"""
Runs a Cala knowledge_search query and saves the results as structured JSON.

Each output record captures:
  - fact: the underlying supporting fact from Cala's explainability trace
  - description: a short 1-2 line summary of that fact
  - timeline: the historical period/date range the fact belongs to

Usage:
  Put CALA_API_KEY=your-key in a .env file at the project root, then:
  python3 backend/knowledge_search.py "What are the most relevant historical periods of Spain"
"""

import argparse
import json
import os
import re
import sys
import urllib.request

CALA_MCP_URL = "https://api.cala.ai/mcp/"


def load_dotenv(path: str) -> None:
    """Minimal .env loader: sets os.environ for KEY=VALUE lines not already set."""
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

# Matches a leading date/era range like "(c. 50,000 BC - 1,100 BC)" or "(711-1492)".
TIMELINE_PATTERN = re.compile(
    r"\(([^()]*?\b(?:BC|AD|century|present)?[^()]*?\d[^()]*?)\)"
)


def call_cala_knowledge_search(query: str, api_key: str) -> dict:
    """Calls the Cala MCP server's knowledge_search tool over HTTP."""
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

    req = urllib.request.Request(
        CALA_MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-API-KEY": api_key,
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8")

    # Cala's MCP endpoint may respond as SSE ("event: message\ndata: {...}") or plain JSON.
    if body.lstrip().startswith("event:"):
        data_lines = [
            line[len("data:"):].strip()
            for line in body.splitlines()
            if line.startswith("data:")
        ]
        body = data_lines[-1] if data_lines else body

    result = json.loads(body)
    if "error" in result:
        raise RuntimeError(f"Cala MCP error: {result['error']}")
    return result["result"]


def extract_timeline(text: str) -> str:
    match = TIMELINE_PATTERN.search(text)
    return match.group(1).strip() if match else ""


def summarize(text: str, max_sentences: int = 2) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[:max_sentences]).strip()


def build_records(mcp_result: dict) -> list:
    """Turns Cala's explainability entries into fact/description/timeline records."""
    content_blocks = mcp_result.get("content", [])
    tool_output = None
    for block in content_blocks:
        if block.get("type") == "text":
            tool_output = json.loads(block["text"])
            break
    if tool_output is None:
        raise RuntimeError("No text content block found in Cala MCP response")

    records = []
    for item in tool_output.get("explainability", []):
        fact = item.get("content", "")
        records.append(
            {
                "fact": fact,
                "description": summarize(fact),
                "timeline": extract_timeline(fact),
            }
        )
    return records


def main():
    parser = argparse.ArgumentParser(description="Run a Cala knowledge_search and save results as JSON.")
    parser.add_argument(
        "query",
        nargs="?",
        default="What are the most relevant historical periods of Spain",
        help="Natural language query to send to Cala's knowledge_search tool.",
    )
    parser.add_argument(
        "-o", "--output",
        default=os.path.join(os.path.dirname(__file__), "..", "data", "knowledge-search.json"),
        help="Path to write the resulting JSON file.",
    )
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    api_key = os.environ.get("CALA_API_KEY")
    if not api_key:
        print("Error: set CALA_API_KEY in the project's .env file before running this script.", file=sys.stderr)
        sys.exit(1)

    try:
        mcp_result = call_cala_knowledge_search(args.query, api_key)
        records = build_records(mcp_result)
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
