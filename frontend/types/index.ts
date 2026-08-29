export type Moment = {
  id: string;
  year: number;
  orderIndex: number;
  title?: string;
  location?: string;
  factText: string;
  sourceRef: string;
  sourceIndices?: number[];
  narrativeCopy: string;
  visualBrief?: string;
  imagePath: string;
  imagePrompt: string;
  styleProfile?: string;
  detailCopy?: string;
  mapPoints?: Array<{
    id: string;
    label: string;
    description: string;
    x: number;
    y: number;
  }>;
  representative?: {
    label: string;
    description: string;
  };
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
