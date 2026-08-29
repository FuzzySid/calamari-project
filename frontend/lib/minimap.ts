import { getCountryRings, type LngLat } from "@/lib/geo";

export type MinimapData = {
  width: number;
  height: number;
  ringPaths: string[];
  /** Projected [x, y] pixel positions, in the same order as the story moments. */
  points: Array<[number, number]>;
};

const PAD = 8;

/**
 * Projects a country outline and scene points into a small SVG pixel space.
 * Runs on the server so the world-features GeoJSON never reaches the client.
 */
export function buildMinimap(
  code: string,
  scenePoints: Array<{ lat: number; lng: number }>,
  width = 132
): MinimapData | null {
  const rings = getCountryRings(code);

  if (rings.length === 0) return null;

  const coords = rings.flat();
  const lngs = coords.map(([lng]) => lng);
  const lats = coords.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Equirectangular projection with the longitude axis compressed by
  // cos(mid-latitude), so the outline keeps its familiar proportions.
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = (width - PAD * 2) / ((maxLng - minLng) * k);
  const height = (maxLat - minLat) * scale + PAD * 2;

  const project = ([lng, lat]: LngLat): [number, number] => [
    Number((PAD + (lng - minLng) * k * scale).toFixed(1)),
    Number((PAD + (maxLat - lat) * scale).toFixed(1))
  ];

  return {
    width,
    height: Number(height.toFixed(1)),
    ringPaths: rings.map(
      (ring) =>
        ring
          .map((coord, i) => {
            const [x, y] = project(coord);
            return `${i === 0 ? "M" : "L"}${x},${y}`;
          })
          .join(" ") + " Z"
    ),
    points: scenePoints.map((point) => project([point.lng, point.lat]))
  };
}
