import fs from "node:fs/promises";
import path from "node:path";
import { createMockCalaClient } from "../lib/cala";
import { createMockFalClient } from "../lib/fal";
import { createMockOpenAIClient } from "../lib/openai";
import type { Country, Moment } from "../types";

async function main() {
  const countryCode = "ESP";
  const startYear = 1492;
  const endYear = 1588;

  const cala = createMockCalaClient();
  const openai = createMockOpenAIClient();
  const fal = createMockFalClient();

  const facts = await cala.getFactsForEra(countryCode, startYear, endYear);
  const assets = await openai.createNarrativeAssets(facts);

  const moments: Moment[] = await Promise.all(
    facts.map(async (fact, index) => {
      const asset = assets[index];
      const imagePath = `moments/spain/${String(index + 1).padStart(2, "0")}.svg`;

      const generatedImagePath = await fal.generateImage({
        prompt: asset.imagePrompt,
        outputPath: imagePath,
        label: `${fact.year}`
      });

      return {
        id: fact.id,
        year: fact.year,
        orderIndex: index,
        factText: fact.factText,
        sourceRef: fact.sourceRef,
        narrativeCopy: asset.narrativeCopy,
        imagePath: generatedImagePath,
        imagePrompt: asset.imagePrompt
      };
    })
  );

  const country: Country = {
    code: countryCode,
    name: "Spain",
    eraLabel: "1492–1588",
    eraStartYear: startYear,
    eraEndYear: endYear,
    eraRationale:
      "This span captures Spain's consolidation under Ferdinand and Isabella, its transatlantic expansion, and the imperial confidence that defined the Spanish Golden Age.",
    moments
  };

  const targetPath = path.join(process.cwd(), "data", "spain.json");
  await fs.writeFile(targetPath, `${JSON.stringify(country, null, 2)}\n`, "utf8");

  console.log(`Wrote ${moments.length} moments to ${targetPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
