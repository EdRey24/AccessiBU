/**
 * Domain model + static reference data for AccessiBU hazard reports.
 * A Floor 2 photo is stored through the report API. Other reports stay in memory.
 */

import { floorFeatures, type FeatureKind, type FloorFeature } from './floor-features';

export { floorFeatures, type FeatureKind, type FloorFeature };

export type HazardType =
  | 'Spill'
  | 'Broken elevator'
  | 'Blocked path'
  | 'Broken door'
  | 'Wet floor'
  | 'Debris'
  | 'Lighting out'
  | 'Other';

export const HAZARD_TYPES: HazardType[] = [
  'Spill',
  'Broken elevator',
  'Blocked path',
  'Broken door',
  'Wet floor',
  'Debris',
  'Lighting out',
  'Other',
];

export type ReportMethod = 'photo' | 'manual';
export type Location = 'inside' | 'outside';

/** Hazard type stored on a report. */
export type StoredHazardType =
  | 'spill'
  | 'blockage'
  | 'elevator'
  | 'entrance'
  | 'walking_surface'
  | 'other';

const STORED_HAZARD_LABEL: Record<StoredHazardType, string> = {
  spill: 'Spill',
  blockage: 'Blockage',
  elevator: 'Elevator',
  entrance: 'Entrance',
  walking_surface: 'Walking surface',
  other: 'Other',
};

/** Label for a hazard type returned by the report API. */
export function storedHazardLabel(hazardType: StoredHazardType): string {
  return STORED_HAZARD_LABEL[hazardType];
}

export type Hazard = {
  id: string;
  type: HazardType;
  severity: number; // 1-10, used for pin color
  /** Passage interference from the stored hazard, 1–10. */
  severityScore?: number | null;
  /** Hazard type written by classification, when this pin was stored. */
  hazardType?: StoredHazardType | null;
  description: string;
  location: Location;
  floor: number | null; // null when outside
  /** Normalized position on the floor plan image (0-1 range). */
  position: { x: number; y: number } | null;
  method: ReportMethod;
  photoUri: string | null;
  createdAt: number;
  /**
   * Resolved spatial context sent to the classifier (pin -> nearest features).
   * Stored so it's inspectable/exportable for the model team.
   */
  spatialContext?: SpatialContext | null;
  /** How severity was derived, for display + debugging. */
  severityReason?: string;
  /**
   * Resolved room the pin fell in (from the floor-plan room polygons), and the
   * real-world coordinate derived from the pin. Populated on report when inside
   * a digitized floor (currently Floor 2). Null/undefined otherwise.
   */
  room?: { name: string; category: string; areaFt2: number } | null;
  coordinate?: { longitude: number; latitude: number } | null;
};

/**
 * CDS student-accessible floors: Basement, Ground, and floors 2–17. The KPMB
 * plans jump from Ground straight to the Second floor (no distinct "First
 * floor" drawing), so floor value 1 is intentionally absent. The lower
 * sub-basement and mechanical penthouses (18/19) are omitted — not public.
 */
export const CDS_FLOORS: { value: number; label: string }[] = [
  { value: 17, label: 'Floor 17' },
  { value: 16, label: 'Floor 16' },
  { value: 15, label: 'Floor 15' },
  { value: 14, label: 'Floor 14' },
  { value: 13, label: 'Floor 13' },
  { value: 12, label: 'Floor 12' },
  { value: 11, label: 'Floor 11' },
  { value: 10, label: 'Floor 10' },
  { value: 9, label: 'Floor 9' },
  { value: 8, label: 'Floor 8' },
  { value: 7, label: 'Floor 7' },
  { value: 6, label: 'Floor 6' },
  { value: 5, label: 'Floor 5' },
  { value: 4, label: 'Floor 4' },
  { value: 3, label: 'Floor 3' },
  { value: 2, label: 'Floor 2' },
  { value: 0, label: 'Ground Floor' },
  { value: -1, label: 'Basement' },
];

/**
 * Real CDS floor-plan images (exported & cropped from the KPMB Draft Project
 * Impact Report). Keyed by floor value. `require` keeps them in the bundle.
 */
export const FLOOR_PLAN_IMAGES: Record<number, number> = {
  [-1]: require('@/assets/floorplans/floor--1.png'),
  0: require('@/assets/floorplans/floor-0.png'),
  2: require('@/assets/floorplans/floor-2.png'),
  3: require('@/assets/floorplans/floor-3.png'),
  4: require('@/assets/floorplans/floor-4.png'),
  5: require('@/assets/floorplans/floor-5.png'),
  6: require('@/assets/floorplans/floor-6.png'),
  7: require('@/assets/floorplans/floor-7.png'),
  8: require('@/assets/floorplans/floor-8.png'),
  9: require('@/assets/floorplans/floor-9.png'),
  10: require('@/assets/floorplans/floor-10.png'),
  11: require('@/assets/floorplans/floor-11.png'),
  12: require('@/assets/floorplans/floor-12.png'),
  13: require('@/assets/floorplans/floor-13.png'),
  14: require('@/assets/floorplans/floor-14.png'),
  15: require('@/assets/floorplans/floor-15.png'),
  16: require('@/assets/floorplans/floor-16.png'),
  17: require('@/assets/floorplans/floor-17.png'),
};

/**
 * Plan image native dimensions. Lower floors (Basement..5) include the long
 * east classroom wing and are exported WIDE; the tower floors (6..17) are the
 * compact square core. The component uses these to lock the correct aspect
 * ratio so pins stay pixel-accurate on both.
 */
const WIDE_SIZE = { width: 2840, height: 1345 };
const TOWER_SIZE = { width: 1570, height: 1440 };
const WIDE_FLOOR_SET = new Set([-1, 0, 2, 3, 4, 5]);

export function floorPlanSize(floor: number): { width: number; height: number } {
  return WIDE_FLOOR_SET.has(floor) ? WIDE_SIZE : TOWER_SIZE;
}

/** Back-compat default (tower). Prefer floorPlanSize(floor). */
export const FLOOR_PLAN_SIZE = TOWER_SIZE;

/** Euclidean distance between two normalized points (0-1 space). */
function normalizedDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The structured spatial context sent to the backend severity classifier.
 * This is the key handoff: the app resolves the pin against the floor-plan
 * geometry so the model never has to understand the map — it just reads these
 * fields and adjusts severity (e.g. nearCriticalEgress -> bump up).
 */
export type SpatialContext = {
  building: 'CDS';
  floor: number;
  floorLabel: string;
  pin: { x: number; y: number };
  nearestFeature: { kind: FloorFeature['kind']; label: string; distance: number } | null;
  nearbyFeatures: { kind: FloorFeature['kind']; label: string; distance: number }[];
  nearCriticalEgress: boolean;
  /** GPS at capture time (coarse; indoors it only confirms the building). */
  gps: { latitude: number; longitude: number; accuracy: number | null } | null;
};

/** Builds the SpatialContext payload for a report. */
export function buildSpatialContext(
  floor: number,
  pin: { x: number; y: number },
  gps: { latitude: number; longitude: number; accuracy?: number | null } | null
): SpatialContext {
  const feats = floorFeatures(floor);
  const withDist = feats
    .map((f) => ({ kind: f.kind, label: f.label, distance: normalizedDistance(pin, f) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = withDist[0] ?? null;
  return {
    building: 'CDS',
    floor,
    floorLabel: floorLabel(floor),
    pin,
    nearestFeature: nearest
      ? { ...nearest, distance: Number(nearest.distance.toFixed(4)) }
      : null,
    nearbyFeatures: withDist
      .filter((f) => f.distance <= 0.25)
      .map((f) => ({ ...f, distance: Number(f.distance.toFixed(4)) })),
    nearCriticalEgress: nearest ? nearest.distance <= 0.12 : false,
    gps: gps
      ? { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy ?? null }
      : null,
  };
}

export function floorPlanImage(floor: number | null): number | undefined {
  if (floor === null) return undefined;
  return FLOOR_PLAN_IMAGES[floor];
}

/**
 * Boston University Center for Computing & Data Sciences (CDS),
 * 665 Commonwealth Ave — corner of Commonwealth Avenue and Granby Street.
 */
export const CDS_LOCATION = {
  longitude: -71.10295,
  latitude: 42.3499,
  /**
   * Footprint polygon (lng/lat) roughly covering the CDS tower base at the
   * Comm Ave / Granby St corner. Tune these corners if needed.
   */
  footprint: [
    [-71.10325, 42.35005],
    [-71.10265, 42.35005],
    [-71.10265, 42.34965],
    [-71.10325, 42.34965],
    [-71.10325, 42.35005],
  ] as [number, number][],
};

export const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

/**
 * Georeferencing corners for the CDS floor-plan images. Each plan image is a
 * fixed rectangle; these map its four corners to real-world lat/lng so a user's
 * GPS can be projected onto the plan as a "you are here" dot.
 *
 * Order matters — these correspond to the image corners:
 *   topLeft     -> image (x=0, y=0)
 *   topRight    -> image (x=1, y=0)
 *   bottomRight -> image (x=1, y=1)
 *   bottomLeft  -> image (x=0, y=1)
 *
 * NOTE: topRight below is an ESTIMATE — the provided value duplicated the
 * bottom-right. Replace it with the surveyed top-right corner when available.
 */
export const CDS_PLAN_CORNERS = {
  topLeft: { latitude: 42.350188, longitude: -71.103353 },
  topRight: { latitude: 42.350161, longitude: -71.102873 },
  bottomRight: { latitude: 42.349847, longitude: -71.102917 },
  bottomLeft: { latitude: 42.349913, longitude: -71.103424 },
};

/**
 * Converts a normalized (0-1) pin on a floor-plan image to a lat/lng, by
 * bilinear interpolation over CDS_PLAN_CORNERS. Used for floors without a
 * digitized room map (every floor except 2, which has its own geometry).
 */
export function planXYToGps(pin: { x: number; y: number }): {
  latitude: number;
  longitude: number;
} {
  const c = CDS_PLAN_CORNERS;
  const top = (k: 'latitude' | 'longitude') => lerp(c.topLeft[k], c.topRight[k], pin.x);
  const bottom = (k: 'latitude' | 'longitude') => lerp(c.bottomLeft[k], c.bottomRight[k], pin.x);
  return {
    latitude: lerp(top('latitude'), bottom('latitude'), pin.y),
    longitude: lerp(top('longitude'), bottom('longitude'), pin.y),
  };
}

/**
 * Projects a GPS coordinate onto the floor-plan image as normalized (x, y) in
 * 0-1 space, using inverse bilinear interpolation over the four georeferenced
 * corners (handles a skewed/rotated building quad, not just an axis-aligned
 * box). Returns null if the point falls well outside the plan.
 *
 * Indoors GPS is coarse, so treat the result as an approximate hint — the user
 * still drags the hazard pin to the exact spot.
 */
export function gpsToPlanXY(coord: {
  latitude: number;
  longitude: number;
}): { x: number; y: number } | null {
  const c = CDS_PLAN_CORNERS;
  // Treat lng as X-ish and lat as Y-ish in a local planar frame.
  const P = { x: coord.longitude, y: coord.latitude };
  const TL = { x: c.topLeft.longitude, y: c.topLeft.latitude };
  const TR = { x: c.topRight.longitude, y: c.topRight.latitude };
  const BR = { x: c.bottomRight.longitude, y: c.bottomRight.latitude };
  const BL = { x: c.bottomLeft.longitude, y: c.bottomLeft.latitude };

  // Solve for (u, v) in [0,1] such that:
  //   Q(u,v) = (1-v)[(1-u)TL + u TR] + v[(1-u)BL + u BR]
  // via iterative refinement (robust for mild skew).
  let u = 0.5;
  let v = 0.5;
  for (let i = 0; i < 20; i++) {
    const top = { x: lerp(TL.x, TR.x, u), y: lerp(TL.y, TR.y, u) };
    const bot = { x: lerp(BL.x, BR.x, u), y: lerp(BL.y, BR.y, u) };
    const q = { x: lerp(top.x, bot.x, v), y: lerp(top.y, bot.y, v) };

    // Partial derivatives of Q w.r.t. u and v.
    const dQdu = {
      x: lerp(TR.x - TL.x, BR.x - BL.x, v),
      y: lerp(TR.y - TL.y, BR.y - BL.y, v),
    };
    const dQdv = { x: bot.x - top.x, y: bot.y - top.y };

    const rx = P.x - q.x;
    const ry = P.y - q.y;

    // Solve 2x2 [dQdu dQdv] * [du dv]^T = r
    const det = dQdu.x * dQdv.y - dQdu.y * dQdv.x;
    if (Math.abs(det) < 1e-18) break;
    const du = (rx * dQdv.y - ry * dQdv.x) / det;
    const dv = (dQdu.x * ry - dQdu.y * rx) / det;
    u += du;
    v += dv;
    if (Math.abs(du) < 1e-6 && Math.abs(dv) < 1e-6) break;
  }

  // Allow a small margin outside the exact footprint.
  if (u < -0.15 || u > 1.15 || v < -0.15 || v > 1.15) return null;
  return { x: clamp01(u), y: clamp01(v) };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Meters between two lat/lng points (haversine). */
export function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** True when a coordinate is within ~60m of the CDS tower (i.e. inside it). */
export function isAtCDS(coord: { latitude: number; longitude: number }): boolean {
  return metersBetween(coord, CDS_LOCATION) <= 60;
}

export function floorLabel(floor: number | null): string {
  if (floor === null) return 'Outside';
  return CDS_FLOORS.find((f) => f.value === floor)?.label ?? `Floor ${floor}`;
}

// Classification + severity scoring now lives in src/services/classifier.ts,
// which calls the backend model with the SpatialContext built above.
