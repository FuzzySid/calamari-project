/**
 * The eras offered by the globe's timeline picker for Spain.
 *
 * `label` is a range: the picker renders the text left of the dash as the
 * headline year and the rest as a smaller tail, so the start year has to come
 * first. The user-facing spans in `note` keep the century phrasing these
 * numeric bounds were derived from.
 *
 * `storyId` points at a generated PeriodStory (see `lib/periods.ts`). Eras
 * without one are listed but not yet navigable.
 */
export type SpainPeriod = {
  id: string;
  name: string;
  label: string;
  note: string;
  storyId?: string;
  concurrentWith?: string[];
};

export const spainPeriods: SpainPeriod[] = [
  {
    id: "pre-roman-iberia",
    name: "Pre-Roman and Ancient Iberia",
    label: "… — 200 BC",
    note: "Before the 2nd century BC",
    storyId: "pre-roman-iberia"
  },
  {
    id: "roman-hispania",
    name: "Roman Hispania",
    label: "218 BC — 476",
    note: "2nd century BC – 5th century AD"
  },
  {
    id: "visigothic-kingdom",
    name: "Visigothic Kingdom",
    label: "418 — 711",
    note: "5th–8th century"
  },
  {
    id: "al-andalus",
    name: "Al-Andalus — Muslim Spain",
    label: "711 — 1492",
    note: "711–1492",
    concurrentWith: ["reconquista"]
  },
  {
    id: "reconquista",
    name: "The Reconquista",
    label: "722 — 1492",
    note: "c. 722–1492",
    concurrentWith: ["al-andalus"]
  },
  {
    id: "golden-age",
    name: "The Spanish Golden Age",
    label: "1500 — 1700",
    note: "16th–17th century"
  },
  {
    id: "bourbon-era",
    name: "Decline and Bourbon Era",
    label: "1700 — 1900",
    note: "18th–19th century"
  },
  {
    id: "civil-war-franco",
    name: "Civil War and Franco's Dictatorship",
    label: "1936 — 1975",
    note: "Civil War 1936–1939 · Dictatorship 1939–1975"
  },
  {
    id: "modern-spain",
    name: "Democratic Transition and Modern Spain",
    label: "1975 — present",
    note: "1975–present"
  }
];
