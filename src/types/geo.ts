// Geographic primitives.
//
// DECISION: AccessiBU represents geography TWO ways on purpose.
//  1. App-friendly `Coordinates { latitude, longitude }` — used by ~99% of code.
//  2. A GeoJSON layer (`GeoJsonPoint`/`GeoJsonPolygon`) used ONLY at the DB boundary,
//     because PostGIS / GeoJSON order coordinates as [longitude, latitude].
//
// GOTCHA: GeoJSON positions are [lng, lat] (X, Y), the OPPOSITE of the
// {latitude, longitude} order humans usually say. Conversion happens in the
// commit-2 data layer, never scattered through feature code.

/** App-friendly coordinate. Order: latitude first (human-readable). */
export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Opaque identifiers. Branded to prevent mixing building/floor ids with plain strings. */
export type BuildingId = string & { readonly __brand: 'BuildingId' };
export type FloorId = string & { readonly __brand: 'FloorId' };

/** App-friendly building footprint used by UI and routing. */
export interface BuildingFootprint {
  readonly buildingId: BuildingId;
  readonly name: string;
  readonly floors: readonly FloorId[];
  /** Simple polygon ring in app-friendly coordinate order. */
  readonly outline: readonly Coordinates[];
  readonly centroid: Coordinates;
}

// ---- GeoJSON boundary layer ([longitude, latitude] ordering) ----

/** A GeoJSON position: [longitude, latitude]. NOTE the lng/lat order. */
export type GeoJsonPosition = readonly [longitude: number, latitude: number];

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: GeoJsonPosition;
}

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  /**
   * Array of linear rings; first is the exterior ring. Each position is [lng, lat].
   * Each linear ring is CLOSED: its first position equals its last position.
   */
  readonly coordinates: readonly (readonly GeoJsonPosition[])[];
}
