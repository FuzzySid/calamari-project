import type { CalaFact } from "@/lib/cala";

type NarrativeAsset = {
  narrativeCopy: string;
  imagePrompt: string;
};

export interface OpenAIClient {
  createNarrativeAssets(facts: CalaFact[]): Promise<NarrativeAsset[]>;
}

export const IMAGE_PROMPT_SYSTEM_GUIDANCE = `
You write historical image prompts for a cohesive illustrated sequence.
Never invent facts beyond the provided source facts.
Use evocative, illustrative scenes rather than photoreal portraits of historical people.
Prefer architecture, ships, maps, objects, textiles, landscapes, and symbolic compositions.
Keep every prompt in the same art direction: painterly, restrained palette, parchment texture, cinematic light.
`.trim();

export function createMockOpenAIClient(): OpenAIClient {
  return {
    async createNarrativeAssets(facts) {
      return facts.map((fact) => ({
        narrativeCopy: `Spain's story shifted in ${fact.year} as institutions, ambition, and empire converged around this moment. The fact stays fixed; the tone reframes it for a visual narrative.`,
        imagePrompt: `Painterly illustrated scene for ${fact.year}: ${fact.factText} Avoid photoreal faces. Focus on setting, objects, architecture, atmosphere, parchment textures, and a coherent gold-blue palette.`
      }));
    }
  };
}

export type { NarrativeAsset };
