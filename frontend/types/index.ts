export type Moment = {
  id: string;
  year: number;
  orderIndex: number;
  factText: string;
  sourceRef: string;
  sourceIndices?: number[];
  narrativeCopy: string;
  visualBrief?: string;
  imagePath: string;
  imagePrompt?: string;
  styleProfile?: string;
};

export type Country = {
  code: string;
  name: string;
  eraLabel: string;
  eraStartYear: number;
  eraEndYear: number;
  eraRationale: string;
  moments: Moment[];
};
