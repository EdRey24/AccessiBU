// Hazard domain model.
//
// DECISION: The category and severity/status lists are declared ONCE as `as const`
// arrays and every union type is DERIVED from them via `(typeof ...)[number]`.
// Downstream files (ai.ts) reuse the same arrays as zod enums, so the lists have
// exactly one source of truth and can never drift between the type and the schema.

import type { BuildingId, Coordinates, FloorId } from './geo';

// Centralized const arrays — reused downstream as zod enums (ai.ts) so the
// category/severity lists have exactly ONE source of truth.

/** Closed set of known hazard categories (excluding the escape hatch). */
export const HAZARD_CATEGORIES = [
  'spill',
  'broken_elevator',
  'blocked_path',
  'broken_door',
  'ice_or_snow',
  'construction',
  'missing_ramp',
  'poor_lighting',
] as const;
export type KnownHazardCategory = (typeof HAZARD_CATEGORIES)[number];

/** Ordinal severity labels, in ascending order of urgency. */
export const HAZARD_SEVERITY_LABELS = ['low', 'moderate', 'high', 'critical'] as const;
export type HazardSeverityLabel = (typeof HAZARD_SEVERITY_LABELS)[number];

/** Report/hazard lifecycle statuses, in lifecycle order. */
export const REPORT_STATUSES = [
  'submitted',
  'ai_classified',
  'community_confirmed',
  'resolved',
  'dismissed',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * HazardCategory is a DISCRIMINATED union: a closed known category, OR an
 * 'other' escape hatch that REQUIRES a free-text description (1–200 chars; the
 * length bound is enforced at the boundary — at the type level `otherDescription`
 * is a NON-OPTIONAL `string`). Known categories FORBID `otherDescription`.
 */
export type HazardCategory =
  | { readonly kind: KnownHazardCategory }
  | { readonly kind: 'other'; readonly otherDescription: string };

/** Numeric severity on a 0–100 scale (branded nominal type). */
export type HazardSeverityScore = number & { readonly __brand: 'HazardSeverityScore' };

export interface Hazard {
  readonly id: string;
  readonly category: HazardCategory;
  readonly severityLabel: HazardSeverityLabel;
  readonly severityScore: HazardSeverityScore;
  readonly status: ReportStatus;
  readonly location: Coordinates;
  readonly buildingId: BuildingId | null;
  readonly floorId: FloorId | null;
  /** Count of community confirmations backing the 'community_confirmed' lifecycle. */
  readonly confirmationCount: number;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
}
