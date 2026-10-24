// HAND-WRITTEN Supabase row types — SOURCE OF TRUTH until the DB schema stabilizes.
//
// COORDINATION: owned jointly with the AI/DB teammate. These hand-written rows are
// the source of truth until `supabase gen types typescript` stabilizes; once the
// schema settles they are to be replaced by / validated against the generated types.
// Keep this file in sync with the DB teammate — do not change a column shape here
// without coordinating the matching migration/schema change.
//
// Conventions mirror what Supabase/Postgres actually returns:
//   * snake_case column keys
//   * timestamptz columns typed as string (ISO)
//   * nullable columns typed `| null` exactly as returned
//   * Insert/Update variants omit generated columns (ids, created_at, updated_at)
//
// Mapping snake_case rows -> camelCase domain entities is the commit-2 data
// layer's job, NOT this file's.

export interface HazardRow {
  id: string;
  category: string;              // known category OR 'other'
  other_description: string | null;
  severity_label: string;
  severity_score: number;
  status: string;
  latitude: number;
  longitude: number;
  building_id: string | null;
  floor_id: string | null;
  confirmation_count: number;
  created_at: string;            // timestamptz
  updated_at: string;            // timestamptz
}
export type HazardInsert = Omit<HazardRow, 'id' | 'confirmation_count' | 'created_at' | 'updated_at'>;
export type HazardUpdate = Partial<HazardInsert>;

export interface ReportRow {
  id: string;
  hazard_id: string | null;      // set once classified
  reporter_id: string | null;
  image_path: string;            // Supabase Storage path
  reporter_hints: string | null;
  latitude: number;
  longitude: number;
  status: string;
  created_at: string;            // timestamptz
  updated_at: string;            // timestamptz
}
export type ReportInsert = Omit<ReportRow, 'id' | 'hazard_id' | 'created_at' | 'updated_at'>;
export type ReportUpdate = Partial<ReportInsert>;

export interface RouteNodeRow {
  id: string;
  building_id: string | null;
  floor_id: string;
  kind: string;
  latitude: number;
  longitude: number;
  wheelchair_accessible: boolean;
  has_tactile_paving: boolean;
  is_step_free: boolean;
  created_at: string;            // timestamptz
}
export type RouteNodeInsert = Omit<RouteNodeRow, 'id' | 'created_at'>;
export type RouteNodeUpdate = Partial<RouteNodeInsert>;

export interface BuildingRow {
  id: string;
  name: string;
  centroid_latitude: number;
  centroid_longitude: number;
  /** GeoJSON Polygon stored at the DB boundary ([lng, lat] order). */
  footprint_geojson: unknown;    // validated/narrowed in the data layer
  created_at: string;            // timestamptz
}
export type BuildingInsert = Omit<BuildingRow, 'id' | 'created_at'>;
export type BuildingUpdate = Partial<BuildingInsert>;

// Community-confirmation lifecycle backing (modeled NOW, per decision).
export interface ConfirmationRow {
  id: string;
  hazard_id: string;
  confirmed_count: number;
  dismissed_count: number;
  reached_threshold_at: string | null; // timestamptz, set when community_confirmed
  created_at: string;            // timestamptz
  updated_at: string;            // timestamptz
}
export type ConfirmationInsert = Omit<ConfirmationRow, 'id' | 'created_at' | 'updated_at'>;
export type ConfirmationUpdate = Partial<ConfirmationInsert>;

export interface VoteRow {
  id: string;
  hazard_id: string;
  voter_id: string;
  vote: string;                  // 'confirm' | 'dismiss'
  created_at: string;            // timestamptz
}
export type VoteInsert = Omit<VoteRow, 'id' | 'created_at'>;
export type VoteUpdate = Partial<VoteInsert>;
