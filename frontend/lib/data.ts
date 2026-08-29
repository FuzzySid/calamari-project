import countryData from "@/data/spain.json";
import type { Country } from "@/types";

export function getCountryByCode(code: string): Country | null {
  if (code.toUpperCase() === countryData.code) {
    return countryData as Country;
  }

  return null;
}

export function getMomentById(code: string, momentId: string) {
  const country = getCountryByCode(code);

  if (!country) {
    return null;
  }

  const moment = country.moments.find((item) => item.id === momentId);

  return moment ? { country, moment } : null;
}
