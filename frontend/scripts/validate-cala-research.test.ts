import assert from "node:assert/strict";
import test from "node:test";
import { getAllPeriodStories } from "@/lib/periods";
import { calaResearchCoverage, validateCalaResearch } from "./validate-cala-research";
import { parseCalaEnvelope } from "./generate-cala-research";

const expectedKeys = ["pre-roman-iberia:hillfort-childhood"];

test("reports missing active Spain scenes without invalidating included research", () => {
  assert.deepEqual(
    validateCalaResearch({}, expectedKeys),
    []
  );
  assert.deepEqual(
    calaResearchCoverage({}, expectedKeys),
    { covered: 0, expected: 1, missing: expectedKeys }
  );
});

test("accepts source-backed research with three facts and an HTTPS source", () => {
  assert.deepEqual(
    validateCalaResearch(
      {
        "pre-roman-iberia:hillfort-childhood": {
          timeline: "400 BC",
          facts: ["One", "Two", "Three"],
          entities: [{ name: "Iberia" }],
          sources: [{ publisher: "Example Archive", url: "https://example.com/source" }]
        }
      },
      expectedKeys
    ),
    []
  );
});

test("rejects a record without timeline and entities metadata", () => {
  assert.deepEqual(
    validateCalaResearch(
      {
        "pre-roman-iberia:hillfort-childhood": {
          timeline: "",
          facts: ["One", "Two", "Three"],
          entities: [],
          sources: [{ publisher: "Example Archive", url: "https://example.com/source" }]
        }
      },
      expectedKeys
    ),
    ["pre-roman-iberia:hillfort-childhood must include a non-empty timeline", "pre-roman-iberia:hillfort-childhood must include at least one entity"]
  );
});

test("attaches available research and leaves a missing scene research-free", () => {
  const scenes = getAllPeriodStories()
    .filter((story) => story.code === "ESP")
    .flatMap((story) => story.moments);

  assert.equal(scenes.length, 13);
  assert.equal(scenes.filter((moment) => moment.research).length, 12);
  assert.equal(
    scenes.find((moment) => moment.id === "modern-spain-a-country-opens")?.research,
    undefined
  );
});

test("uses the JSON-RPC result frame when Cala appends an SSE ping", () => {
  assert.deepEqual(
    parseCalaEnvelope('event: message\ndata: {"result":{"content":[]}}\n\nevent: ping\ndata: : ping - 2\n'),
    { result: { content: [] } }
  );
});
