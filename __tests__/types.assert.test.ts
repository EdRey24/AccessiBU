/**
 * Compile-time type-level assertions for the shared type contract.
 *
 * These assertions are erased at runtime — their value is that `npx tsc --noEmit`
 * MUST fail if the contract regresses. Every `@ts-expect-error` below is paired
 * with a genuine type error; if the contract is fixed-up so the error disappears,
 * the now-unused `@ts-expect-error` itself becomes an error (self-checking).
 *
 * Mirrors the design's "Type-level assertions (compile-time)" section.
 *
 * Property 3: Schema/contract non-drift — Validates: Requirements 9.2
 * Property 6: Result exhaustiveness/narrowing — Validates: Requirements 9.2
 * Property 4: Escape hatch integrity ('other' needs otherDescription)
 * Property 9: Insert/Update omit generated columns — Validates: Requirements 5.4
 */

import {
    hazardClassificationResultSchema,
    type HazardCategory,
    type HazardClassificationResult,
    type HazardClassificationResultParsed,
    type HazardInsert,
    type Result,
} from '@/types';
import type { z } from 'zod';

// ---- Type-level assertion helpers (compile-time only). ----
type Expect<T extends true> = T;
type Equal<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Extends<A, B> = A extends B ? true : false;

// =====================================================================
// Property 3 — Schema/contract non-drift
// The zod-inferred type must be assignable to the hand-written contract type.
// (Mirrors the internal guard in ai.ts for test-file visibility.)
// =====================================================================
type _InferredMatchesSchema = Expect<
  Equal<HazardClassificationResultParsed, z.infer<typeof hazardClassificationResultSchema>>
>;
type _SchemaAssignableToContract = Expect<
  Extends<HazardClassificationResultParsed, HazardClassificationResult>
>;
// Value-level mirror: parsed shape is assignable to the contract type.
const _schemaMatchesContract: HazardClassificationResult =
  {} as HazardClassificationResultParsed;
void _schemaMatchesContract;

// =====================================================================
// Property 6 — Result narrowing on the `ok` discriminant
// =====================================================================
function _assertResultNarrowing(r: Result<number>): void {
  if (r.ok) {
    // `.data` is accessible on the success branch.
    const _data: number = r.data;
    void _data;
    // `.error` does NOT exist on the success branch.
    // @ts-expect-error - error is not present when ok === true
    void r.error;
  } else {
    // `.error` is accessible on the failure branch.
    const _err = r.error;
    void _err;
    // `.data` does NOT exist on the failure branch.
    // @ts-expect-error - data is not present when ok === false
    void r.data;
  }
}
void _assertResultNarrowing;

// =====================================================================
// Property 4 — Escape hatch integrity
// `kind: 'other'` REQUIRES otherDescription; a known category must NOT allow it.
// =====================================================================

// A known category with no otherDescription is valid.
const _knownCategory: HazardCategory = { kind: 'spill' };
void _knownCategory;

// `kind: 'other'` with a description is valid.
const _otherWithDescription: HazardCategory = {
  kind: 'other',
  otherDescription: 'uncatalogued obstruction',
};
void _otherWithDescription;

// `kind: 'other'` WITHOUT otherDescription must fail to type-check.
// @ts-expect-error - 'other' requires a non-optional otherDescription
const _otherMissingDescription: HazardCategory = { kind: 'other' };
void _otherMissingDescription;

// A known category must NOT accept otherDescription (excess property).
const _knownWithDescription: HazardCategory = {
  kind: 'spill',
  // @ts-expect-error - otherDescription is only allowed on the 'other' variant
  otherDescription: 'should not be allowed',
};
void _knownWithDescription;

// =====================================================================
// Property 9 — Insert variants omit generated columns
// Supplying `id` or `created_at` on a HazardInsert literal is rejected.
// =====================================================================

// A valid HazardInsert: every column EXCEPT the generated ones.
const _validHazardInsert: HazardInsert = {
  category: 'spill',
  other_description: null,
  severity_label: 'high',
  severity_score: 72,
  status: 'ai_classified',
  latitude: 42.35,
  longitude: -71.1,
  building_id: null,
  floor_id: null,
};
void _validHazardInsert;

// Supplying the generated `id` column is rejected (excess property).
const _hazardInsertWithId: HazardInsert = {
  // @ts-expect-error - 'id' is a generated column omitted from HazardInsert
  id: 'hz_1',
  category: 'spill',
  other_description: null,
  severity_label: 'high',
  severity_score: 72,
  status: 'ai_classified',
  latitude: 42.35,
  longitude: -71.1,
  building_id: null,
  floor_id: null,
};
void _hazardInsertWithId;

// Supplying the generated `created_at` column is rejected (excess property).
const _hazardInsertWithCreatedAt: HazardInsert = {
  // @ts-expect-error - 'created_at' is a generated column omitted from HazardInsert
  created_at: '2025-01-01T00:00:00Z',
  category: 'spill',
  other_description: null,
  severity_label: 'high',
  severity_score: 72,
  status: 'ai_classified',
  latitude: 42.35,
  longitude: -71.1,
  building_id: null,
  floor_id: null,
};
void _hazardInsertWithCreatedAt;

// This file is all compile-time assertions; a trivial runtime test keeps Jest happy.
describe('type-level contract assertions', () => {
  test('compile-time assertions are enforced by tsc --noEmit', () => {
    expect(true).toBe(true);
  });
});
