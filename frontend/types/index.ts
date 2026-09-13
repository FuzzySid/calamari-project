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

export type StoryMoment = {
  id: string;
  orderIndex: number;
  title: string;
  location: {
    label: string;
    lat: number;
    lng: number;
  };
  narrativeCopy: string;
  factText: string;
  sourceRef: string;
  imagePath: string;
  imagePrompt: string;
  /** 360° equirectangular video for the immersive viewer; falls back to imagePath. */
  videoPath?: string;
  research?: CalaResearchRecord;
};

export type CalaSource = {
  publisher: string;
  url: string;
  date?: string;
};

export type CalaEntity = {
  name: string;
  type?: string;
};

export type CalaResearchRecord = {
  /** A source-backed date or period extracted from the Cala result. */
  timeline: string;
  facts: string[];
  /** Cala entities, or names extracted directly from source-backed facts. */
  entities: CalaEntity[];
  sources: CalaSource[];
};

export type PeriodStory = {
  code: string;
  name: string;
  periodId: string;
  eraLabel: string;
  eraRationale: string;
  storyTagline: string;
  stylePrefix: string;
  moments: StoryMoment[];
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
