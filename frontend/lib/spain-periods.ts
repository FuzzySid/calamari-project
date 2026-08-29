/**
 * The eras offered by the globe's timeline picker for Spain.
 *
 * `label` is the single year that anchors the era, not its full span. Spans
 * would repeat every boundary year down the column (711 closing the Visigoths
 * and opening Al-Andalus, 1492 closing both Al-Andalus and the Reconquista),
 * so only the defining year is shown. The full spans live in `note`.
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
    label: "200 BC",
    note: "Before the 2nd century BC",
    storyId: "pre-roman-iberia"
  },
  {
    id: "roman-hispania",
    name: "Roman Hispania",
    label: "218 BC",
    note: "2nd century BC – 5th century AD"
  },
  {
    id: "visigothic-kingdom",
    name: "Visigothic Kingdom",
    label: "418",
    note: "5th–8th century"
  },
  {
    id: "al-andalus",
    name: "Al-Andalus — Muslim Spain",
    label: "711",
    note: "711–1492",
    concurrentWith: ["reconquista"]
  },
  {
    id: "reconquista",
    name: "The Reconquista",
    label: "722",
    note: "c. 722–1492",
    concurrentWith: ["al-andalus"]
  },
  {
    id: "golden-age",
    name: "The Spanish Golden Age",
    label: "1500",
    note: "16th–17th century"
  },
  {
    id: "bourbon-era",
    name: "Decline and Bourbon Era",
    label: "1700",
    note: "18th–19th century"
  },
  {
    id: "civil-war-franco",
    name: "Civil War and Franco's Dictatorship",
    label: "1936",
    note: "Civil War 1936–1939 · Dictatorship 1939–1975"
  },
  {
    id: "modern-spain",
    name: "Democratic Transition and Modern Spain",
    label: "1975",
    note: "1975–present"
  }
];
