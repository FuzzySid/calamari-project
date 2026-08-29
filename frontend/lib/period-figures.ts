/**
 * Resolves the 3D figure shown between the globe and the timeline — a typical
 * person of the selected era and place.
 *
 * Convention (no code change needed to add one): drop the model at
 *
 *     frontend/public/<country>/models/<period id>.<glb|gltf|fbx|obj>
 *
 * e.g. `public/spain/models/pre-roman-iberia.glb`, alongside that country's
 * `videos/`. The extension is probed at runtime, so any of the four formats
 * works. Anything that breaks the convention — a shared model, a name that
 * cannot be changed — goes in `figureOverrides`.
 *
 * Periods with no model fall back to a stylised placeholder figure, so the
 * reveal still plays before the models land.
 */

/** Probed in order; the first file that exists wins. */
const EXTENSIONS = ["glb", "gltf", "fbx", "obj"] as const;

/** ISO3 → the public/ folder that country's assets live in. */
const COUNTRY_FOLDERS: Record<string, string> = {
  ESP: "spain",
  JPN: "japan"
};

/** `"<CODE>:<periodId>"` → public path, for models that break the convention. */
const figureOverrides: Record<string, string> = {
  // "ESP:al-andalus": "/spain/models/andalusi-merchant.glb"
};

export type FigureSource = {
  url: string;
  /** Extra scale on top of the automatic bounding-box fit. */
  scale?: number;
  /** Starting yaw in radians. */
  rotationY?: number;
};

/** `"<CODE>:<periodId>"` → per-model tweaks, applied after the automatic fit. */
const figureTuning: Record<string, Omit<FigureSource, "url">> = {
  // "ESP:golden-age": { scale: 1.1, rotationY: -0.4 }
};

const resolved = new Map<string, FigureSource | null>();

function figureKey(code: string, periodId: string) {
  return `${code}:${periodId}`;
}

async function exists(url: string) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Finds the model for an era, or null when none is present yet. Results are
 * memoised so scrolling back up the timeline never re-probes.
 */
export async function resolveFigureSource(
  code: string,
  periodId: string
): Promise<FigureSource | null> {
  const key = figureKey(code, periodId);
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  const tuning = figureTuning[key] ?? {};
  const override = figureOverrides[key];
  let source: FigureSource | null = null;

  if (override) {
    source = { url: override, ...tuning };
  } else {
    const folder = COUNTRY_FOLDERS[code] ?? code.toLowerCase();
    const base = `/${folder}/models/${periodId}`;
    for (const extension of EXTENSIONS) {
      const url = `${base}.${extension}`;
      if (await exists(url)) {
        source = { url, ...tuning };
        break;
      }
    }
  }

  resolved.set(key, source);
  return source;
}
