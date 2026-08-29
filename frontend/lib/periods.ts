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

function loadPublicEvents(year: string): PublicEvent[] {
  const dataPath = path.join(process.cwd(), "public", "spain", "data.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8")) as PublicCountryData;
  const events = data.events[year];

  if (!events) {
    throw new Error(`No Spain events found for ${year} in ${dataPath}`);
  }

  return events;
}

function buildPreRomanStory(): PeriodStory {
  const story = preRomanIberia as PeriodStory;
  const events = loadPublicEvents("-250");

  if (events.length !== story.moments.length) {
    throw new Error(
      `Spain -250 has ${events.length} videos but ${story.moments.length} story moments`
    );
  }

  const moments = story.moments.map((moment, index) => {
    const event = events[index];
    const videoPath = `/spain/${event.video_url.replace(/^\//, "")}`;
    const absoluteVideoPath = path.join(process.cwd(), "public", videoPath.replace(/^\//, ""));

    if (!fs.existsSync(absoluteVideoPath)) {
      throw new Error(`Spain event video does not exist: ${absoluteVideoPath}`);
    }

    return {
      ...moment,
      title: event.title,
      narrativeCopy: event.description,
      videoPath
    };
  });

  return { ...story, moments };
}

const periodStories: PeriodStory[] = [buildPreRomanStory()];

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
