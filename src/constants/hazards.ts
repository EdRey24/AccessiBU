/**
 * Domain model + static reference data for AccessiBU hazard reports.
 * UI-only for now; a backend will replace the in-memory store later.
 */

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

export type Hazard = {
  id: string;
  type: HazardType;
  severity: number; // 1-10
  description: string;
  location: Location;
  floor: number | null; // null when outside
  /** Normalized position on the floor plan image (0-1 range). */
  position: { x: number; y: number } | null;
  method: ReportMethod;
  photoUri: string | null;
  createdAt: number;
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

/** Plan image native dimensions (all exports share this size). */
export const FLOOR_PLAN_SIZE = { width: 1570, height: 1440 };

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

export type AnalysisResult = {
  type: HazardType;
  severity: number;
  description: string;
};

/**
 * Mock AI photo analysis. Stands in for a vision model (Supabase edge function
 * / OpenAI / etc.) until the backend is wired up. Returns a plausible hazard
 * classification so the report flow is demoable end-to-end. Deterministic-ish
 * via the photo URI so the same shot yields the same result.
 */
export function analyzeHazardPhoto(photoUri: string | null): Promise<AnalysisResult> {
  const samples: AnalysisResult[] = [
    { type: 'Spill', severity: 6, description: 'Liquid spill detected on the floor — slip risk in a walking path.' },
    { type: 'Wet floor', severity: 4, description: 'Wet floor surface detected; proceed with caution.' },
    { type: 'Blocked path', severity: 7, description: 'Obstruction blocking an accessible route.' },
    { type: 'Debris', severity: 5, description: 'Loose debris detected on the ground.' },
    { type: 'Broken elevator', severity: 8, description: 'Elevator appears out of service — accessibility impact.' },
    { type: 'Lighting out', severity: 3, description: 'Low lighting / outage detected in this area.' },
  ];
  const seed = (photoUri ?? '').length;
  const pick = samples[seed % samples.length];
  // Simulate model latency.
  return new Promise((resolve) => setTimeout(() => resolve(pick), 1400));
}
