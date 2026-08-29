import fs from "node:fs";
import path from "node:path";
import preRomanIberia from "@/data/spain-preroman.json";
import type { PeriodStory } from "@/types";

const periodStories: PeriodStory[] = [preRomanIberia as PeriodStory];

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
