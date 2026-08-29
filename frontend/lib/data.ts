import countryData from "@/data/spain.json";
import type { Country } from "@/types";

export function getCountryByCode(code: string): Country | null {
  if (code.toUpperCase() === countryData.code) {
    return countryData as Country;
  }

  return null;
}
