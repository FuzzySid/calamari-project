import fs from "node:fs";
import path from "node:path";
import type { CalaResearchRecord } from "@/types";

export type CalaResearchByScene = Record<string, CalaResearchRecord>;

export type CalaResearchCoverage = {
  covered: number;
  expected: number;
  missing: string[];
};

export function calaResearchCoverage(
  research: CalaResearchByScene,
  expectedKeys: string[]
): CalaResearchCoverage {
  const missing = expectedKeys.filter((key) => !research[key]);
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
  research: CalaResearchByScene,
  expectedKeys: string[]
): string[] {
  const errors: string[] = [];
  const expected = new Set(expectedKeys);

  for (const key of expectedKeys) {
    const record = research[key];
    if (!record) continue;
    if (!record.timeline?.trim()) {
      errors.push(`${key} must include a non-empty timeline`);
    }
    if (record.facts.length < 3 || record.facts.length > 5 || record.facts.some((fact) => !fact.trim())) {
      errors.push(`${key} must contain 3–5 non-empty fact strings`);
    }
    if (!record.entities?.length || record.entities.some((entity) => !entity.name.trim())) {
      errors.push(`${key} must include at least one entity`);
    }
    if (record.sources.length === 0) {
      errors.push(`${key} must contain at least one source`);
    }
    for (const source of record.sources) {
      if (!source.publisher.trim()) {
        errors.push(`${key} has a source without a publisher`);
      }
      if (!isHttpUrl(source.url)) {
        errors.push(`${key} has an invalid HTTP(S) source URL: ${source.url}`);
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

function duplicateKeysInJson(raw: string): string[] {
  const keys = Array.from(raw.matchAll(/^\s{2}"([^"]+)"\s*:/gm)).map((match) => match[1]);
  return Array.from(new Set(keys.filter((key, index) => keys.indexOf(key) !== index)));
}

function main(): void {
  const dataPath = path.join(process.cwd(), "data", "spain-cala-research.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  const duplicateKeys = duplicateKeysInJson(raw);
  const research = JSON.parse(raw) as CalaResearchByScene;
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
