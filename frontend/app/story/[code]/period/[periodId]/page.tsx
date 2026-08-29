import { notFound } from "next/navigation";
import { PeriodStoryPlayer } from "@/components/period-story-player";
import { buildMinimap } from "@/lib/minimap";
import { getAllPeriodStories, getPeriodStory, resolveMomentImage } from "@/lib/periods";

type PeriodStoryPageProps = {
  params: {
    code: string;
    periodId: string;
  };
};

export function generateStaticParams() {
  return getAllPeriodStories().map((story) => ({
    code: story.code,
    periodId: story.periodId
  }));
}

export default function PeriodStoryPage({ params }: PeriodStoryPageProps) {
  const story = getPeriodStory(params.code, params.periodId);

  if (!story) notFound();

  const moments = story.moments.map((moment) => ({
    ...moment,
    imagePath: resolveMomentImage(moment.imagePath)
  }));

  const minimap = buildMinimap(
    story.code,
    moments.map((moment) => ({ lat: moment.location.lat, lng: moment.location.lng }))
  );

  return <PeriodStoryPlayer story={{ ...story, moments }} minimap={minimap} />;
}
