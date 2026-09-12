import assert from "node:assert/strict";
import test from "node:test";
import { isSafeResearchUrl } from "./cala-research-tooltip";

test("isSafeResearchUrl permits only absolute HTTP(S) source links", () => {
  assert.equal(isSafeResearchUrl("https://www.bne.es/history"), true);
  assert.equal(isSafeResearchUrl("http://archives.example.org/source"), true);
  assert.equal(isSafeResearchUrl("javascript:alert(1)"), false);
  assert.equal(isSafeResearchUrl("data:text/html,unsafe"), false);
  assert.equal(isSafeResearchUrl("/local-source"), false);
});
