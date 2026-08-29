export type Moment = {
  id: string;
  year: number;
  orderIndex: number;
  title?: string;
  location?: string;
  factText: string;
  sourceRef: string;
  narrativeCopy: string;
  detailCopy?: string;
  imagePath: string;
  imagePrompt: string;
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
