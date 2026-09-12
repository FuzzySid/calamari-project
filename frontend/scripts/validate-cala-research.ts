import fs from "node:fs";
import path from "node:path";
import type { CalaResearchRecord } from "@/types";

export type CalaResearchByScene = Record<string, CalaResearchRecord>;

export type CalaResearchCoverage = {
  covered: number;
  expected: number;
  missing: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function calaResearchCoverage(
  research: unknown,
  expectedKeys: string[]
): CalaResearchCoverage {
  const missing = expectedKeys.filter((key) => !isObject(research) || !research[key]);
  return {
    covered: expectedKeys.length - missing.length,
    expected: expectedKeys.length,
    missing
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateCalaResearch(
  research: unknown,
  expectedKeys: string[]
): string[] {
  const errors: string[] = [];
  const expected = new Set(expectedKeys);

  if (!isObject(research)) {
    return ["Cala research must be a JSON object keyed by scene key"];
  }

  for (const key of expectedKeys) {
    const record = research[key];
    if (!record) continue;
    if (!isObject(record)) {
      errors.push(`${key} must be an object`);
      continue;
    }
    if (typeof record.timeline !== "string") {
      errors.push(`${key} timeline must be a string`);
    } else if (!record.timeline.trim()) {
      errors.push(`${key} must include a non-empty timeline`);
    }
    if (!Array.isArray(record.facts)) {
      errors.push(`${key} facts must be an array of strings`);
    } else if (record.facts.length < 3 || record.facts.length > 5 || record.facts.some((fact) => typeof fact !== "string" || !fact.trim())) {
      errors.push(`${key} must contain 3–5 non-empty fact strings`);
    }
    if (!Array.isArray(record.entities) || record.entities.length === 0) {
      errors.push(`${key} must include at least one entity`);
    } else {
      for (const entity of record.entities) {
        if (!isObject(entity) || typeof entity.name !== "string" || !entity.name.trim()) {
          errors.push(`${key} has an entity without a non-empty name`);
        } else if ("type" in entity && typeof entity.type !== "string") {
          errors.push(`${key} has an entity type that is not a string`);
        }
      }
    }
    if (!Array.isArray(record.sources) || record.sources.length === 0) {
      errors.push(`${key} must contain at least one source`);
      continue;
    }
    for (const source of record.sources) {
      if (!isObject(source)) {
        errors.push(`${key} has an invalid source record`);
        continue;
      }
      if (typeof source.publisher !== "string" || !source.publisher.trim()) {
        errors.push(`${key} has a source without a publisher`);
      }
      if (typeof source.url !== "string") {
        errors.push(`${key} has an invalid HTTP(S) source URL`);
      } else if (!isHttpUrl(source.url)) {
        errors.push(`${key} has an invalid HTTP(S) source URL: ${source.url}`);
      }
      if ("date" in source && typeof source.date !== "string") {
        errors.push(`${key} has a source date that is not a string`);
      }
    }
  }

  for (const key of Object.keys(research)) {
    if (!expected.has(key)) {
      errors.push(`Cala research has no active Spain scene for key: ${key}`);
    }
  }

  return errors;
}

function skipWhitespace(raw: string, index: number): number {
  while (/\s/.test(raw[index] ?? "")) index += 1;
  return index;
}

function readJsonString(raw: string, index: number): [string, number] {
  if (raw[index] !== '"') throw new Error("Expected a JSON string");
  const start = index;
  index += 1;
  while (index < raw.length) {
    if (raw[index] === "\\") {
      index += 2;
    } else if (raw[index] === '"') {
      const end = index + 1;
      return [JSON.parse(raw.slice(start, end)) as string, end];
    } else {
      index += 1;
    }
  }
  throw new Error("Unterminated JSON string");
}

function skipJsonValue(raw: string, index: number): number {
  index = skipWhitespace(raw, index);
  if (raw[index] === '"') return readJsonString(raw, index)[1];
  if (raw[index] === "{") {
    index = skipWhitespace(raw, index + 1);
    if (raw[index] === "}") return index + 1;
    while (true) {
      [, index] = readJsonString(raw, index);
      index = skipWhitespace(raw, index);
      if (raw[index] !== ":") throw new Error("Expected a JSON object colon");
      index = skipJsonValue(raw, index + 1);
      index = skipWhitespace(raw, index);
      if (raw[index] === "}") return index + 1;
      if (raw[index] !== ",") throw new Error("Expected a JSON object separator");
      index = skipWhitespace(raw, index + 1);
    }
  }
  if (raw[index] === "[") {
    index = skipWhitespace(raw, index + 1);
    if (raw[index] === "]") return index + 1;
    while (true) {
      index = skipJsonValue(raw, index);
      index = skipWhitespace(raw, index);
      if (raw[index] === "]") return index + 1;
      if (raw[index] !== ",") throw new Error("Expected a JSON array separator");
      index = skipWhitespace(raw, index + 1);
    }
  }
  const next = raw.slice(index).search(/[\s,}\]]/);
  if (next === -1) return raw.length;
  return index + next;
}

export function duplicateTopLevelJsonKeys(raw: string): string[] {
  try {
    let index = skipWhitespace(raw, 0);
    if (raw[index] !== "{") return [];
    index = skipWhitespace(raw, index + 1);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    while (raw[index] !== "}") {
      const [key, afterKey] = readJsonString(raw, index);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
      index = skipWhitespace(raw, afterKey);
      if (raw[index] !== ":") return [];
      index = skipJsonValue(raw, index + 1);
      index = skipWhitespace(raw, index);
      if (raw[index] === "}") break;
      if (raw[index] !== ",") return [];
      index = skipWhitespace(raw, index + 1);
    }
    return Array.from(duplicates);
  } catch {
    return [];
  }
}

function main(): void {
  const dataPath = path.join(process.cwd(), "data", "spain-cala-research.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  const duplicateKeys = duplicateTopLevelJsonKeys(raw);
  let research: unknown;
  try {
    research = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Cala research validation failed:\n- Invalid JSON: ${reason}`);
    process.exitCode = 1;
    return;
  }
  const { getAllPeriodStories } = require("../lib/periods") as typeof import("../lib/periods");
  const expectedKeys = getAllPeriodStories()
    .filter((story) => story.code === "ESP")
    .flatMap((story) => story.moments.map((moment) => `${story.periodId}:${moment.id}`));
  const errors = [
    ...duplicateKeys.map((key) => `Duplicate Cala research key: ${key}`),
    ...validateCalaResearch(research, expectedKeys)
  ];
  const coverage = calaResearchCoverage(research, expectedKeys);

  if (errors.length > 0) {
    console.error(`Cala research validation failed:\n- ${errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const missingSuffix = coverage.missing.length
    ? `; ${coverage.missing.length} without research: ${coverage.missing.join(", ")}`
    : "";
  console.log(
    `Cala research validation passed: ${coverage.covered} of ${coverage.expected} active Spain scenes covered${missingSuffix}.`
  );
}

if (require.main === module) {
  main();
}
