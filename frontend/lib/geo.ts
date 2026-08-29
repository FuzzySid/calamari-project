import worldFeatures from "@/data/world-features.json";

export type LngLat = [number, number];

type GeoFeature = {
  properties?: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

/** Outer rings of a country's landmass, as [lng, lat] coordinate lists. */
export function getCountryRings(code: string): LngLat[][] {
  const feature = (worldFeatures as { features: GeoFeature[] }).features.find(
    (item) => item.properties?.ADM0_A3 === code.toUpperCase()
  );

  if (!feature) return [];

  const { type, coordinates } = feature.geometry;

  if (type === "Polygon") {
    return [(coordinates as LngLat[][])[0]];
  }

  if (type === "MultiPolygon") {
    return (coordinates as LngLat[][][]).map((polygon) => polygon[0]);
  }

  return [];
}
