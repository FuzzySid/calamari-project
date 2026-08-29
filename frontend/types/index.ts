export type Moment = {
  id: string;
  year: number;
  orderIndex: number;
  factText: string;
  sourceRef: string;
  narrativeCopy: string;
  imagePath: string;
  imagePrompt: string;
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
