import assert from "node:assert/strict";
import test from "node:test";
import { getAllPeriodStories } from "@/lib/periods";
import { calaResearchCoverage, duplicateTopLevelJsonKeys, validateCalaResearch } from "./validate-cala-research";
import { parseCalaEnvelope, recordFromResponse, sourceBackedTimelineFromFacts } from "./generate-cala-research";

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

test("reports present falsey scene records as malformed", () => {
  const malformedKeys = ["period:null", "period:zero", "period:false"];
  assert.deepEqual(
    validateCalaResearch(
      { "period:null": null, "period:zero": 0, "period:false": false },
      malformedKeys
    ),
    [
      "period:null must be an object",
      "period:zero must be an object",
      "period:false must be an object"
    ]
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

test("reports malformed record fields without throwing", () => {
  assert.deepEqual(
    validateCalaResearch(
      {
        "pre-roman-iberia:hillfort-childhood": {
          timeline: 400,
          facts: "not an array",
          entities: [{ name: 12 }],
          sources: [{ publisher: null, url: 12, date: 400 }]
        }
      },
      expectedKeys
    ),
    [
      "pre-roman-iberia:hillfort-childhood timeline must be a string",
      "pre-roman-iberia:hillfort-childhood facts must be an array of strings",
      "pre-roman-iberia:hillfort-childhood has an entity without a non-empty name",
      "pre-roman-iberia:hillfort-childhood has a source without a publisher",
      "pre-roman-iberia:hillfort-childhood has an invalid HTTP(S) source URL",
      "pre-roman-iberia:hillfort-childhood has a source date that is not a string"
    ]
  );
});

test("rejects invalid URLs, invalid fact counts, and stale keys", () => {
  assert.deepEqual(
    validateCalaResearch(
      {
        "pre-roman-iberia:hillfort-childhood": {
          timeline: "400 BC",
          facts: ["Only one"],
          entities: [{ name: "Iberia" }],
          sources: [{ publisher: "Example Archive", url: "ftp://example.com/source" }]
        },
        "stale-period:stale-moment": {
          timeline: "400 BC",
          facts: ["One", "Two", "Three"],
          entities: [{ name: "Iberia" }],
          sources: [{ publisher: "Example Archive", url: "https://example.com/source" }]
        }
      },
      expectedKeys
    ),
    [
      "pre-roman-iberia:hillfort-childhood must contain 3–5 non-empty fact strings",
      "pre-roman-iberia:hillfort-childhood has an invalid HTTP(S) source URL: ftp://example.com/source",
      "Cala research has no active Spain scene for key: stale-period:stale-moment"
    ]
  );
});

test("detects duplicate top-level keys in minified JSON", () => {
  assert.deepEqual(
    duplicateTopLevelJsonKeys('{"pre-roman-iberia:hillfort-childhood":{},"pre-roman-iberia:hillfort-childhood":{}}'),
    ["pre-roman-iberia:hillfort-childhood"]
  );
});

test("rejects Cala records whose source-backed facts have no date metadata", () => {
  assert.throws(
    () => recordFromResponse({
      explainability: [
        { content: "Emporion traded pottery and olive oil.", references: ["context-1"] },
        { content: "Greek merchants exchanged goods with local communities.", references: ["context-1"] },
        { content: "The settlement connected maritime trade routes.", references: ["context-1"] }
      ],
      context: [
        {
          id: "context-1",
          origins: [{ document: { name: "Example Archive", url: "https://example.com/source" } }]
        }
      ]
    }),
    /source-backed date metadata/
  );
});

test("preserves the full source-backed century range in a generated timeline", () => {
  assert.equal(
    sourceBackedTimelineFromFacts(["Iberian settlements were built between the 6th and 3rd centuries BC."]),
    "6th and 3rd centuries BC"
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
