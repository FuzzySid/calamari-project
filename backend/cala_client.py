"""
Shared Cala MCP client helpers: HTTP/JSON-RPC calls, provenance-chain resolution,
and .env loading. Used by knowledge_search_events.py and generate_encyclopedia.py
so both scripts talk to Cala the same way and extract citations the same way.
"""

import json
import os
import time
import urllib.error
import urllib.request

CALA_MCP_URL = "https://api.cala.ai/mcp/"
MAX_RATE_LIMIT_RETRIES = 8
RATE_LIMIT_BACKOFF_SECONDS = 20
MIN_SECONDS_BETWEEN_CALLS = 4.0

_last_call_time = 0.0


def _throttle() -> None:
    """Enforces a minimum gap between Cala calls to stay under its rate limit
    proactively, rather than relying solely on retry-after-429."""
    global _last_call_time
    elapsed = time.monotonic() - _last_call_time
    if elapsed < MIN_SECONDS_BETWEEN_CALLS:
        time.sleep(MIN_SECONDS_BETWEEN_CALLS - elapsed)
    _last_call_time = time.monotonic()


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


class CalaToolError(RuntimeError):
    """Raised when a Cala MCP tool call fails in a way that may be worth retrying
    (isError: true responses, HTTP 429, empty bodies)."""


def _call_mcp_tool(tool_name: str, arguments: dict, api_key: str, timeout: int = 60) -> dict:
    """Calls a Cala MCP tool over HTTP (JSON-RPC tools/call) and returns its "result"."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
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

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if exc.code == 429:
            raise CalaToolError(f"HTTP 429 rate_limit_exceeded: {body}")
        raise RuntimeError(f"Cala MCP HTTP error {exc.code}: {body}")

    # Cala's MCP endpoint may respond as SSE ("event: message\ndata: {...}") or plain JSON.
    if body.lstrip().startswith("event:"):
        data_lines = [
            line[len("data:"):].strip()
            for line in body.splitlines()
            if line.startswith("data:")
        ]
        body = data_lines[-1] if data_lines else body

    if not body.strip():
        raise CalaToolError("Cala MCP returned an empty response body (likely rate_limit or transient failure)")

    result = json.loads(body)
    if "error" in result:
        raise RuntimeError(f"Cala MCP error: {result['error']}")
    return result["result"]


def _tool_output(mcp_result: dict) -> dict:
    """Extracts and JSON-decodes the text content block from a tools/call result."""
    text = None
    for block in mcp_result.get("content", []):
        if block.get("type") == "text":
            text = block["text"]
            break
    if text is None:
        raise RuntimeError("No text content block found in Cala MCP response")
    if mcp_result.get("isError"):
        raise CalaToolError(text)
    return json.loads(text)


def call_tool(tool_name: str, arguments: dict, api_key: str, timeout: int = 60) -> dict:
    """Calls a Cala MCP tool and returns its decoded output, throttling proactively
    between calls and retrying with growing backoff on transient failures (rate
    limits, empty bodies) - anything raised as CalaToolError."""
    last_error = None
    for attempt in range(MAX_RATE_LIMIT_RETRIES):
        _throttle()
        try:
            mcp_result = _call_mcp_tool(tool_name, arguments, api_key, timeout=timeout)
            return _tool_output(mcp_result)
        except CalaToolError as exc:
            last_error = exc
            time.sleep(RATE_LIMIT_BACKOFF_SECONDS * (attempt + 1))
    raise last_error


def call_knowledge_search(query: str, api_key: str) -> dict:
    """Calls Cala's knowledge_search tool. Returns the decoded tool output
    (content, explainability, context, entities)."""
    return call_tool(
        "knowledge_search",
        {"input": query, "explainability": True, "return_entities": True},
        api_key,
    )


def call_entity_search(name: str, api_key: str, entity_types=None, limit: int = 20) -> list:
    """Calls Cala's entity_search tool. Returns the list of matching entities."""
    arguments = {"name": name, "limit": limit}
    if entity_types:
        arguments["entity_types"] = entity_types
    return call_tool("entity_search", arguments, api_key).get("entities", [])


def call_entity_introspection(entity_id: str, api_key: str) -> dict:
    """Calls Cala's entity_introspection tool. Returns {properties, relationships,
    numerical_observations} describing what's queryable for this entity."""
    return call_tool("entity_introspection", {"entity_id": entity_id}, api_key)


def call_entity_retrieval(entity_id: str, api_key: str, properties=None, relationships=None) -> dict:
    """Calls Cala's entity_retrieval tool. With no properties/relationships, returns
    a coarse default profile; otherwise projects exactly what's asked for."""
    arguments = {"entity_id": entity_id}
    if properties:
        arguments["properties"] = properties
    if relationships:
        arguments["relationships"] = relationships
    return call_tool("entity_retrieval", arguments, api_key)


def resolve_source(references: list, context_by_id: dict) -> tuple:
    """Resolves (title, url) for a claim via Cala's provenance chain: the first cited
    context's source document name/url (falling back to its publisher name/url)."""
    for ref_id in references:
        context = context_by_id.get(ref_id)
        if not context:
            continue
        for origin in context.get("origins") or []:
            document = origin.get("document") or {}
            if document.get("name"):
                return document.get("name"), document.get("url", "")
            source = origin.get("source") or {}
            if source.get("name"):
                return source.get("name"), source.get("url", "")
    return "", ""


def context_by_id(tool_output: dict) -> dict:
    """Indexes a knowledge_search tool output's "context" list by id, for use with
    resolve_source()."""
    return {ctx["id"]: ctx for ctx in tool_output.get("context", []) if "id" in ctx}
