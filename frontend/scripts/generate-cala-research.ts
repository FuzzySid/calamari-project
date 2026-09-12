import fs from "node:fs";
import path from "node:path";
import type { CalaEntity, CalaResearchRecord, CalaSource } from "@/types";
import type { CalaResearchByScene } from "./validate-cala-research";

const CALA_MCP_URL = "https://api.cala.ai/mcp/";
const CALA_REQUEST_TIMEOUT_MS = 25_000;

export function parseCalaEnvelope(body: string): { error?: unknown; result?: { content?: Array<{ type?: string; text?: string }> } } {
  const frames = body.trimStart().startsWith("event:")
    ? body.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trim())
    : [body];
  for (const frame of frames) {
    try {
      const envelope = JSON.parse(frame) as { error?: unknown; result?: { content?: Array<{ type?: string; text?: string }> } };
      if (envelope.result || envelope.error) return envelope;
    } catch {
      // Cala emits SSE keep-alive frames such as `: ping - 2` after a result.
    }
  }
  throw new Error("Cala response did not contain a JSON-RPC result frame");
}

function loadRootEnv(): void {
  const envPath = path.resolve(process.cwd(), "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^("|')|("|')$/g, "");
  }
}

async function callCala(
  input: string,
  apiKey: string,
  sceneKey: string
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALA_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CALA_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-API-KEY": apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "knowledge_search",
          arguments: { input, explainability: true, return_entities: true }
        }
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const envelope = parseCalaEnvelope(await response.text());
    if (envelope.error) throw new Error("Cala returned an error response");
    const text = envelope.result?.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Cala response did not contain research text");
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cala request for ${sceneKey} failed after ${CALA_REQUEST_TIMEOUT_MS / 1000}s: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

function sourcesForClaim(claim: Record<string, unknown>, contexts: Map<string, Record<string, unknown>>): CalaSource[] {
  const sources: CalaSource[] = [];
  const seen = new Set<string>();
  for (const reference of (claim.references as string[] | undefined) ?? []) {
    const context = contexts.get(reference);
    for (const origin of (context?.origins as Array<Record<string, unknown>> | undefined) ?? []) {
      const document = (origin.document ?? origin.source ?? {}) as Record<string, unknown>;
      const url = typeof document.url === "string" ? document.url : "";
      const publisher = typeof document.name === "string" ? document.name : "";
      if (!url || !publisher || seen.has(url)) continue;
      seen.add(url);
      const date = [document, origin]
        .map((item) => item.date ?? item.published_at ?? item.publishedAt)
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      sources.push({ publisher, url, ...(date ? { date } : {}) });
    }
  }
  return sources;
}

function timelineFromFacts(facts: string[], fallback: string): string {
  const datePattern = /\b(?:c\.?\s*)?(?:\d{1,4}(?:\s*[–-]\s*\d{1,4})?\s*(?:BC|BCE|AD|CE)|\d{1,2}(?:st|nd|rd|th)(?:\s*[–-]\s*\d{1,2}(?:st|nd|rd|th))?\s+centur(?:y|ies)|\d{3,4}(?:\s*[–-]\s*\d{3,4})?)/i;
  for (const fact of facts) {
    const match = fact.match(datePattern);
    if (match) return match[0].trim();
  }
  return fallback;
}

const ENTITY_STOPWORDS = new Set([
  "A", "An", "The", "These", "This", "That", "Those", "After", "During", "Following",
  "Fortified", "Archaeological", "Botanical", "Sites", "Two", "Rome", "Spain"
]);

function inferredEntitiesFromFacts(facts: string[]): CalaEntity[] {
  const found = new Set<string>();
  for (const fact of facts) {
    const matches = fact.match(/\b(?:[A-Z][A-Za-zÀ-ÖØ-öø-ÿ]+)(?:\s+(?:[A-Z][A-Za-zÀ-ÖØ-öø-ÿ]+|al|ibn|de|del|la|las|los|I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII))*/g) ?? [];
    for (const match of matches) {
      const name = match.trim();
      if (!ENTITY_STOPWORDS.has(name) && name.length > 2) found.add(name);
    }
  }
  return Array.from(found).slice(0, 8).map((name) => ({ name }));
}

function entitiesForFacts(response: Record<string, unknown>, facts: string[]): CalaEntity[] {
  const entities: CalaEntity[] = [];
  const seen = new Set<string>();
  const factText = facts.join(" ").toLocaleLowerCase();
  for (const entity of (response.entities as Array<Record<string, unknown>> | undefined) ?? []) {
    const name = typeof entity.name === "string" ? entity.name.trim() : "";
    const mentions = (entity.mentions as string[] | undefined) ?? [];
    const mentioned = [name, ...mentions].some((value) => factText.includes(value.toLocaleLowerCase()));
    if (!name || !mentioned || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    const type = typeof entity.entity_type === "string" ? entity.entity_type.trim() : "";
    entities.push({ name, ...(type ? { type } : {}) });
  }
  return entities.length > 0 ? entities : inferredEntitiesFromFacts(facts);
}

function recordFromResponse(response: Record<string, unknown>, fallbackTimeline: string): CalaResearchRecord {
  const contexts = new Map(
    ((response.context as Array<Record<string, unknown>> | undefined) ?? [])
      .filter((context): context is Record<string, unknown> & { id: string } => typeof context.id === "string")
      .map((context) => [context.id, context])
  );
  const facts: string[] = [];
  const sources: CalaSource[] = [];
  const seenSources = new Set<string>();
  for (const claim of (response.explainability as Array<Record<string, unknown>> | undefined) ?? []) {
    const fact = typeof claim.content === "string" ? claim.content.trim() : "";
    const claimSources = sourcesForClaim(claim, contexts);
    if (!fact || claimSources.length === 0 || facts.includes(fact)) continue;
    facts.push(fact);
    for (const source of claimSources) {
      if (!seenSources.has(source.url)) {
        seenSources.add(source.url);
        sources.push(source);
      }
    }
    if (facts.length === 5) break;
  }
  if (facts.length < 3 || sources.length === 0) {
    throw new Error("Cala returned fewer than three source-backed facts for a scene");
  }
  const entities = entitiesForFacts(response, facts);
  if (entities.length === 0) {
    throw new Error("Cala returned no entities that could be attached to source-backed facts for a scene");
  }
  return { timeline: timelineFromFacts(facts, fallbackTimeline), facts, entities, sources };
}

function normalizeExistingRecord(record: CalaResearchRecord, fallbackTimeline: string): CalaResearchRecord {
  const timeline = timelineFromFacts(record.facts, record.timeline?.trim() || fallbackTimeline);
  const entities = record.entities?.filter((entity) => entity.name?.trim()) ?? inferredEntitiesFromFacts(record.facts);
  return { ...record, timeline, entities };
}

function writeResearch(outputPath: string, output: CalaResearchByScene): void {
  const temporaryPath = `${outputPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
}

function requestedSceneKey(): string | undefined {
  const onlyIndex = process.argv.indexOf("--only");
  if (onlyIndex === -1) return undefined;
  const key = process.argv[onlyIndex + 1];
  if (!key || key.startsWith("--")) throw new Error("--only requires a periodId:momentId scene key");
  return key;
}

async function main(): Promise<void> {
  loadRootEnv();
  const apiKey = process.env.CALA_API_KEY;
  if (!apiKey) throw new Error("CALA_API_KEY is required in the repository-root environment");
  const { getAllPeriodStories } = require("../lib/periods") as typeof import("../lib/periods");
  const scenes = getAllPeriodStories().filter((story) => story.code === "ESP").flatMap((story) =>
    story.moments.map((moment) => ({ key: `${story.periodId}:${moment.id}`, story, moment }))
  );
  const only = requestedSceneKey();
  const selectedScenes = only ? scenes.filter((scene) => scene.key === only) : scenes;
  if (only && selectedScenes.length === 0) throw new Error(`No active Spain scene matches --only ${only}`);
  const outputPath = path.join(process.cwd(), "data", "spain-cala-research.json");
  const existing = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, "utf8")) as CalaResearchByScene
    : {};
  const output = Object.fromEntries(scenes.map((scene) => {
    const record = existing[scene.key];
    return [scene.key, record ? normalizeExistingRecord(record, scene.story.eraLabel) : undefined];
  }).filter(([, record]) => record)) as CalaResearchByScene;
  writeResearch(outputPath, output);

  for (const scene of selectedScenes) {
    if (output[scene.key]?.facts.length >= 3 && output[scene.key]?.sources.length >= 1 && output[scene.key]?.entities.length >= 1 && output[scene.key]?.timeline) {
      console.log(`Reusing ${scene.key}`);
      continue;
    }
    const query = `Provide 3 to 5 concise, source-backed historical facts for the Spain scene titled "${scene.moment.title}" in the ${scene.story.eraLabel} period. The story context is: ${scene.moment.narrativeCopy}. Facts must be supported by the retrieved sources and should be plain factual sentences.`;
    try {
      console.log(`Requesting Cala research for ${scene.key} (timeout ${CALA_REQUEST_TIMEOUT_MS / 1000}s)`);
      output[scene.key] = recordFromResponse(
        await callCala(query, apiKey, scene.key),
        scene.story.eraLabel
      );
      writeResearch(outputPath, output);
      console.log(`Researched ${scene.key}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Cala research stopped at ${scene.key}: ${message}. Existing checkpoints were preserved.`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`Wrote ${Object.keys(output).length} Cala research records to data/spain-cala-research.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Cala research generation failed");
    process.exitCode = 1;
  });
}
