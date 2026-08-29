import { notFound } from "next/navigation";
import { TimePlaceExperience } from "@/components/time-place-experience";
import { getCountryByCode, getMomentById } from "@/lib/data";

type TimePlacePageProps = {
  params: {
    code: string;
    moment: string;
  };
};

export function generateStaticParams() {
  const country = getCountryByCode("ESP");

  return (
    country?.moments.map((moment) => ({
      code: country.code,
      moment: moment.id
    })) ?? []
  );
}

export default function TimePlacePage({ params }: TimePlacePageProps) {
  const entry = getMomentById(params.code, params.moment);

  if (!entry) notFound();

  return <TimePlaceExperience country={entry.country} moment={entry.moment} />;
}
