import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalaResearchRecord } from "@/types";
import {
  ResearchBookIcon,
  ResearchFactsNote,
  ResearchSourcesNote,
  isSafeResearchUrl
} from "./cala-research-tooltip";

const research: CalaResearchRecord = {
  timeline: "575 BC",
  facts: ["Emporion became a key trading settlement on the north-east Iberian coast."],
  entities: [{ name: "Emporion", type: "place" }],
  sources: [{ publisher: "Example archive", url: "https://example.org" }]
};

test("renders a label-free facts note and a compact book icon trigger", () => {
  const note = renderToStaticMarkup(createElement(ResearchFactsNote, { momentId: "emporion", research }));
  const icon = renderToStaticMarkup(createElement(ResearchBookIcon));

  assert.match(note, /575 BC/);
  assert.match(note, /Emporion became a key trading settlement/);
  assert.match(note, /<p[^>]*>Emporion became a key trading settlement/);
  assert.doesNotMatch(note, /Story by Cala|Cala provenance|sources|Example archive/i);
  assert.match(icon, /<svg/);
  assert.match(icon, /<path/);
});

test("renders source links under the Cala Sources label without provenance wording", () => {
  const sources = renderToStaticMarkup(createElement(ResearchSourcesNote, { research }));

  assert.match(sources, /Cala Sources/);
  assert.match(sources, /Example archive/);
  assert.doesNotMatch(sources, /Cala provenance/i);
  assert.equal(isSafeResearchUrl("https://example.org"), true);
  assert.equal(isSafeResearchUrl("javascript:alert(1)"), false);
});
