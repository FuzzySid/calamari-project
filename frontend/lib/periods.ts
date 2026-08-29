import fs from "node:fs";
import path from "node:path";
import preRomanIberia from "@/data/spain-preroman.json";
import type { PeriodStory } from "@/types";

type PublicEvent = {
  title: string;
  description: string;
  video_url: string;
};

type PublicCountryData = {
  events: Record<string, PublicEvent[]>;
};

type StoryLocation = {
  label: string;
  lat: number;
  lng: number;
};

type PublicStoryDefinition = {
  country: string;
  code: string;
  name: string;
  periodId: string;
  year: string;
  eraLabel: string;
  eraRationale: string;
  locations: StoryLocation[];
};

function loadPublicEvents(country: string, year: string): PublicEvent[] {
  const dataPath = path.join(process.cwd(), "public", country, "data.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8")) as PublicCountryData;
  const events = data.events[year];

  if (!events) {
    throw new Error(`No ${country} events found for ${year} in ${dataPath}`);
  }

  return events;
}

function resolveVideoPath(country: string, videoUrl: string): string {
  const videoPath = `/${country}/${videoUrl.replace(/^\//, "")}`;
  const absoluteVideoPath = path.join(process.cwd(), "public", videoPath.replace(/^\//, ""));

  if (!fs.existsSync(absoluteVideoPath)) {
    throw new Error(`${country} event video does not exist: ${absoluteVideoPath}`);
  }

  return videoPath;
}

function buildPreRomanStory(): PeriodStory {
  const story = preRomanIberia as PeriodStory;
  const events = loadPublicEvents("spain", "-250");

  if (events.length !== story.moments.length) {
    throw new Error(
      `Spain -250 has ${events.length} videos but ${story.moments.length} story moments`
    );
  }

  const moments = story.moments.map((moment, index) => {
    const event = events[index];

    return {
      ...moment,
      title: event.title,
      narrativeCopy: event.description,
      videoPath: resolveVideoPath("spain", event.video_url)
    };
  });

  return { ...story, moments };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildPublicStory(definition: PublicStoryDefinition): PeriodStory {
  const events = loadPublicEvents(definition.country, definition.year);
  const fallbackLocation = definition.locations[0] ?? {
    label: definition.name,
    lat: 0,
    lng: 0
  };

  return {
    code: definition.code,
    name: definition.name,
    periodId: definition.periodId,
    eraLabel: definition.eraLabel,
    eraRationale: definition.eraRationale,
    storyTagline: "Stand inside a turning point in history.",
    stylePrefix: "Photorealistic 360-degree historical reconstruction.",
    moments: events.map((event, index) => ({
      id: `${definition.periodId}-${slugify(event.title)}`,
      orderIndex: index,
      title: event.title,
      location: definition.locations[index] ?? fallbackLocation,
      narrativeCopy: event.description,
      factText: event.description,
      sourceRef: "Provided historical brief",
      videoPath: resolveVideoPath(definition.country, event.video_url),
      imagePath: "/og.png",
      imagePrompt: ""
    }))
  };
}

const publicStoryDefinitions: PublicStoryDefinition[] = [
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "roman-hispania",
    year: "-218",
    eraLabel: "Roman Hispania",
    eraRationale: "Roman rule reshaped Hispania through cities, roads, law and infrastructure.",
    locations: [{ label: "Roman Hispania", lat: 39.5, lng: -3.5 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "visigothic-kingdom",
    year: "418",
    eraLabel: "Visigothic Kingdom",
    eraRationale: "A new kingdom emerged over the surviving structures of Roman Hispania.",
    locations: [{ label: "Visigothic Hispania", lat: 39.8, lng: -3.8 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "al-andalus",
    year: "711",
    eraLabel: "Al-Andalus",
    eraRationale: "Al-Andalus became a major center of urban life, scholarship and exchange.",
    locations: [{ label: "Córdoba", lat: 37.8882, lng: -4.7794 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "reconquista",
    year: "722",
    eraLabel: "The Reconquista",
    eraRationale: "Changing frontiers reshaped the peninsula over centuries of conflict.",
    locations: [{ label: "Iberian frontier", lat: 39.2, lng: -4.1 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "golden-age",
    year: "1500",
    eraLabel: "The Spanish Golden Age",
    eraRationale: "Spain became a global power during the 16th and 17th centuries.",
    locations: [{ label: "Atlantic Spain", lat: 37.2, lng: -6.1 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "bourbon-era",
    year: "1700",
    eraLabel: "Decline and Bourbon Era",
    eraRationale: "Dynastic change, invasion and political upheaval transformed the kingdom.",
    locations: [{ label: "Spain", lat: 40.2, lng: -3.7 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "civil-war-franco",
    year: "1936",
    eraLabel: "Civil War and Franco's Dictatorship",
    eraRationale: "Civil war was followed by a dictatorship that lasted until 1975.",
    locations: [{ label: "Spain", lat: 40.2, lng: -3.7 }]
  },
  {
    country: "spain",
    code: "ESP",
    name: "Spain",
    periodId: "modern-spain",
    year: "1975",
    eraLabel: "Democratic Transition and Modern Spain",
    eraRationale: "Spain became a parliamentary democracy and joined the European Community.",
    locations: [{ label: "Spain", lat: 40.2, lng: -3.7 }]
  },
  {
    country: "japan",
    code: "JPN",
    name: "Japan",
    periodId: "sengoku-period",
    year: "1500",
    eraLabel: "Sengoku Period",
    eraRationale: "Social mobility and prolonged warfare reshaped life in 16th-century Japan.",
    locations: [
      { label: "Rural Japan", lat: 36.2, lng: 138.25 },
      { label: "Sengoku castle town", lat: 35.2, lng: 136.9 },
      { label: "Daimyō army mustering ground", lat: 35.4, lng: 137.0 },
      { label: "Sengoku battlefield", lat: 35.1, lng: 137.1 },
      { label: "Daimyō residence", lat: 35.4, lng: 136.8 }
    ]
  }
];

const periodStories: PeriodStory[] = [
  buildPreRomanStory(),
  ...publicStoryDefinitions.map(buildPublicStory)
];

export function getPeriodStory(code: string, periodId: string): PeriodStory | null {
  return (
    periodStories.find(
      (story) => story.code === code.toUpperCase() && story.periodId === periodId
    ) ?? null
  );
}

export function getAllPeriodStories(): PeriodStory[] {
  return periodStories;
}

/**
 * The generated images land as .jpg files later in the build; until a moment's
 * jpg exists on disk we serve its .svg placeholder so the page never shows a
 * broken frame.
 */
export function resolveMomentImage(imagePath: string): string {
  const absolute = path.join(process.cwd(), "public", imagePath.replace(/^\//, ""));

  if (fs.existsSync(absolute)) {
    return imagePath;
  }

  return imagePath.replace(/\.jpg$/, ".svg");
}
