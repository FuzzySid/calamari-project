type CalaFact = {
  id: string;
  year: number;
  factText: string;
  sourceRef: string;
};

export interface CalaClient {
  getFactsForEra(countryCode: string, startYear: number, endYear: number): Promise<CalaFact[]>;
}

export function createMockCalaClient(): CalaClient {
  return {
    async getFactsForEra() {
      return [
        {
          id: "granada-falls",
          year: 1492,
          factText:
            "Granada surrendered to Ferdinand II and Isabella I in January 1492, ending the Nasrid kingdom in Iberia.",
          sourceRef: "Mock Cala: Granada timeline"
        },
        {
          id: "columbus-sails",
          year: 1492,
          factText:
            "Christopher Columbus departed in August 1492 under the patronage of the Catholic Monarchs and reached the Caribbean that October.",
          sourceRef: "Mock Cala: First voyage dossier"
        },
        {
          id: "tordesillas",
          year: 1494,
          factText:
            "The Treaty of Tordesillas in 1494 divided newly claimed overseas territories between Spain and Portugal along an agreed meridian.",
          sourceRef: "Mock Cala: Treaty summary"
        },
        {
          id: "charles-v",
          year: 1519,
          factText:
            "Charles I of Spain became Holy Roman Emperor Charles V in 1519, linking Spanish power to a wider European imperial network.",
          sourceRef: "Mock Cala: Imperial succession notes"
        },
        {
          id: "escorial-rises",
          year: 1563,
          factText:
            "Construction of El Escorial began in 1563 under Philip II, symbolizing royal authority, piety, and administrative order.",
          sourceRef: "Mock Cala: Architecture brief"
        },
        {
          id: "armada",
          year: 1588,
          factText:
            "The Spanish Armada sailed against England in 1588 and was ultimately dispersed after battle, weather, and logistical strain.",
          sourceRef: "Mock Cala: Naval campaign log"
        }
      ];
    }
  };
}

export type { CalaFact };
