/**
 * Floor-plan room mapping + georeferencing for CDS Floor 2.
 *
 * Pipeline (the "where exactly is this report" chain):
 *
 *   hazard pin (normalized 0–1 on the plan image)
 *     --> local building meters  (origin = SW corner, +x east, +y north)
 *     --> room polygon hit-test   -> which room is affected (name + category)
 *     --> real-world lng/lat       -> coordinate to store / map / notify on
 *
 * The room geometry comes from src/constants/floorplans/floor-2-rooms.geojson
 * (48 named room polygons + a building_outline, all in LOCAL METERS per its
 * crs_note). We georeference those local meters with a 4-parameter similarity
 * transform (scale is 1 m->m, plus rotation + translation) anchored on the real
 * CDS footprint.
 *
 * GEOREF ACCURACY: the anchor (center, bearing) is derived from the surveyed
 * OSM footprint of CDS. It places rooms within a few meters and the correct
 * orientation. Refine CENTER_LNG/LAT and BEARING_DEG against ground-control
 * points for survey-grade accuracy.
 */

import rooms from '@/constants/floorplans/floor-2-rooms.json';

export type RoomCategory =
  | 'office'
  | 'study'
  | 'workspace'
  | 'service'
  | 'restroom'
  | 'stair'
  | 'corridor'
  | 'elevator'
  | 'lab'
  | 'classroom';

export type RoomProps = {
  name: string;
  category: RoomCategory;
  level: number;
  area_m2: number;
  area_ft2: number;
  label_point: [number, number];
};

type Ring = [number, number][];

type RoomFeature = {
  id?: string;
  geometry: { type: 'Polygon'; coordinates: Ring[] };
  properties: RoomProps;
};

type RoomsGeoJSON = {
  building_outline: { type: 'Polygon'; coordinates: Ring[] };
  features: RoomFeature[];
};

const DATA = rooms as unknown as RoomsGeoJSON;

// Local-meter extent of the floor, from the building outline. Used to convert
// a normalized plan pin into local meters.
const OUTLINE: Ring = DATA.building_outline.coordinates[0];
const LOCAL = (() => {
  const xs = OUTLINE.map((p) => p[0]);
  const ys = OUTLINE.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
})();

// --------------------------------------------------------------------------- //
// Georeference anchors (real CDS footprint, from OSM way 277434241).
// --------------------------------------------------------------------------- //
const CENTER_LNG = -71.1029576;
const CENTER_LAT = 42.3500112;
/** Clockwise rotation of local +x (east) from true east, in degrees. */
const BEARING_DEG = 9.11;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((CENTER_LAT * Math.PI) / 180);

// --------------------------------------------------------------------------- //
// Pin (normalized 0–1 on plan image) -> local building meters.
// Image y grows DOWN; local y grows NORTH, so y is flipped.
// --------------------------------------------------------------------------- //
export function pinToLocalMeters(pin: { x: number; y: number }): { x: number; y: number } {
  return {
    x: LOCAL.minX + pin.x * LOCAL.width,
    y: LOCAL.minY + (1 - pin.y) * LOCAL.height,
  };
}

// --------------------------------------------------------------------------- //
// Local meters -> real-world lng/lat (4-parameter similarity transform).
// --------------------------------------------------------------------------- //
export function localMetersToLngLat(m: { x: number; y: number }): {
  longitude: number;
  latitude: number;
} {
  // Offset from the building centroid, in meters.
  const cx = (LOCAL.minX + LOCAL.maxX) / 2;
  const cy = (LOCAL.minY + LOCAL.maxY) / 2;
  const ex = m.x - cx; // east-ish, meters
  const ny = m.y - cy; // north-ish, meters

  // Rotate by the building bearing (clockwise) into true east/north.
  const t = (BEARING_DEG * Math.PI) / 180;
  const east = ex * Math.cos(t) + ny * Math.sin(t);
  const north = -ex * Math.sin(t) + ny * Math.cos(t);

  return {
    longitude: CENTER_LNG + east / M_PER_DEG_LNG,
    latitude: CENTER_LAT + north / M_PER_DEG_LAT,
  };
}

// --------------------------------------------------------------------------- //
// Point-in-polygon room hit-test.
// --------------------------------------------------------------------------- //
function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/** Room that a local-meter point falls in. Smallest matching room wins. */
export function roomAtLocalMeters(m: { x: number; y: number }): RoomFeature | null {
  let best: RoomFeature | null = null;
  let bestArea = Infinity;
  for (const f of DATA.features) {
    const ring = f.geometry.coordinates[0];
    if (pointInRing(m.x, m.y, ring)) {
      const a = ringArea(ring);
      if (a < bestArea) {
        bestArea = a;
        best = f;
      }
    }
  }
  return best;
}

// --------------------------------------------------------------------------- //
// Top-level: hazard pin -> full resolved location.
// --------------------------------------------------------------------------- //
export type ResolvedLocation = {
  /** Room the pin landed in, or null if it fell outside every room polygon. */
  room: { name: string; category: RoomCategory; areaFt2: number } | null;
  /** Real-world coordinate for the pin. */
  coordinate: { longitude: number; latitude: number };
  /** Local building meters, for debugging / routing. */
  localMeters: { x: number; y: number };
};

// --------------------------------------------------------------------------- //
// Rendering: rooms as normalized (0–1) polygons for drawing the floor plan.
// Local meters -> normalized plan coords (x right, y DOWN to match the image).
// --------------------------------------------------------------------------- //
export const FLOOR2_ASPECT = LOCAL.width / LOCAL.height;

/** Fill color per room category for the vector floor plan. */
export const ROOM_COLORS: Record<RoomCategory, string> = {
  office: '#F4D3A8',
  study: '#F6F0C8',
  workspace: '#BFD4EA',
  lab: '#BEE3E0',
  classroom: '#F3D2CC',
  restroom: '#E3E0D4',
  stair: '#D7D7D7',
  elevator: '#C9CDD2',
  corridor: '#EFEADF',
  service: '#D0CCC4',
};

export type RoomShape = {
  id: string;
  name: string;
  category: RoomCategory;
  fill: string;
  /** Normalized 0–1 points, y flipped so north is up on screen. */
  points: { x: number; y: number }[];
  /** Normalized label anchor. */
  label: { x: number; y: number };
};

function localToNorm(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - LOCAL.minX) / LOCAL.width,
    y: 1 - (y - LOCAL.minY) / LOCAL.height, // flip: local north-up -> screen top-down
  };
}

/** All Floor-2 rooms as normalized polygons ready to render as SVG. */
export function floor2RoomShapes(): RoomShape[] {
  return DATA.features.map((f) => {
    const ring = f.geometry.coordinates[0];
    const [lx, ly] = f.properties.label_point;
    return {
      id: f.id ?? f.properties.name,
      name: f.properties.name,
      category: f.properties.category,
      fill: ROOM_COLORS[f.properties.category] ?? '#EEE',
      points: ring.map(([x, y]) => localToNorm(x, y)),
      label: localToNorm(lx, ly),
    };
  });
}

/** Building outline as a normalized polygon (the exterior shell). */
export function floor2OutlineShape(): { x: number; y: number }[] {
  return OUTLINE.map(([x, y]) => localToNorm(x, y));
}

/**
 * Resolve a hazard pin on the Floor-2 plan to its room and real coordinate.
 * `pin` is normalized 0–1 (as stored on a Hazard).
 */
export function resolveFloor2Location(pin: { x: number; y: number }): ResolvedLocation {
  const local = pinToLocalMeters(pin);
  const coordinate = localMetersToLngLat(local);
  const hit = roomAtLocalMeters(local);
  return {
    room: hit
      ? { name: hit.properties.name, category: hit.properties.category, areaFt2: hit.properties.area_ft2 }
      : null,
    coordinate,
    localMeters: local,
  };
}
