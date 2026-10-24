// ⚠️ SERVER-ONLY MODULE — imported by Supabase Edge Functions (Deno runtime). ⚠️
//
// Request-DTO boundary validation for the three Edge Functions. Each zod schema
// mirrors the transport-neutral request DTO from `@/types`
// (`SubmitReportRequest`, `GetHazardsRequest`, `RouteRequest`) so an Edge
// Function can `safeParse` an untrusted JSON body and either hand a typed value
// to the service or return a `validation_error`.
//
// This module is pure zod + `@/types` with NO Supabase/Gemini/Deno coupling, so
// it is fully unit-testable from the app side (jest/tsc/oxlint cover it). The
// Deno `index.ts` handlers stay thin by delegating validation here.
//
// SINGLE SOURCE OF TRUTH: enums are derived from the same const arrays the type
// contract exposes (`HAZARD_SEVERITY_LABELS`, `TRAVERSAL_MODES`) so the schemas
// can never drift from the union types. A compile-time guard at the bottom of
// the file asserts each inferred type is assignable to the hand-written DTO.

import { z } from 'zod';

import type {
  AvoidancePolicy,
  Coordinates,
  GetHazardsRequest,
  RouteConstraints,
  RouteRequest,
  SubmitReportRequest,
} from '@/types';
import { HAZARD_SEVERITY_LABELS, TRAVERSAL_MODES } from '@/types';

/**
 * App-friendly coordinate. Latitude is constrained to [-90, 90] and longitude
 * to [-180, 180] per Requirement 1.1 (the type contract documents the ranges;
 * the schema enforces them at the boundary).
 */
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** Request body for the `submit-report` Edge Function. */
export const submitReportRequestSchema = z.object({
  imagePath: z.string().min(1),
  location: coordinatesSchema,
  reporterHints: z.string().min(1).optional(),
});

/**
 * Request body for the `get-hazards` Edge Function. Every field is optional on
 * the DTO; the hazard service enforces the "center + radius required" policy so
 * the boundary schema stays faithful to the transport-neutral type.
 */
export const getHazardsRequestSchema = z.object({
  center: coordinatesSchema.optional(),
  radiusMeters: z.number().positive().optional(),
  buildingId: z.string().min(1).optional(),
});

/** Allowed traversal modes, derived from the routing const array. */
const traversalModeSchema = z.enum(TRAVERSAL_MODES);

/** Accessibility constraints carried by a route request. */
export const routeConstraintsSchema = z.object({
  requireStepFree: z.boolean(),
  allowedModes: z.array(traversalModeSchema),
});

/**
 * Per-request avoidance policy. `severityThreshold` reuses the hazard severity
 * const array; `mode` is the closed `soft_penalty | hard_block` set.
 */
export const avoidancePolicySchema = z.object({
  severityThreshold: z.enum(HAZARD_SEVERITY_LABELS),
  radiusMeters: z.number().nonnegative(),
  mode: z.enum(['soft_penalty', 'hard_block']),
});

/** Request body for the `request-route` Edge Function. */
export const routeRequestSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema,
  constraints: routeConstraintsSchema,
  avoidance: avoidancePolicySchema,
});

// ---- inferred types -------------------------------------------------------

export type SubmitReportRequestParsed = z.infer<typeof submitReportRequestSchema>;
export type GetHazardsRequestParsed = z.infer<typeof getHazardsRequestSchema>;
export type RouteRequestParsed = z.infer<typeof routeRequestSchema>;

// ---- compile-time non-drift guards ----------------------------------------
//
// If a schema and its hand-written DTO diverge, these assignments fail
// `npx tsc --noEmit`. (Not re-exported from `@/types`; internal to this file.)

const _coordinatesMatches: Coordinates = {} as z.infer<typeof coordinatesSchema>;
const _submitMatches: SubmitReportRequest = {} as SubmitReportRequestParsed;
const _getHazardsMatches: GetHazardsRequest = {} as GetHazardsRequestParsed;
const _constraintsMatches: RouteConstraints = {} as z.infer<typeof routeConstraintsSchema>;
const _avoidanceMatches: AvoidancePolicy = {} as z.infer<typeof avoidancePolicySchema>;
const _routeMatches: RouteRequest = {} as RouteRequestParsed;
void _coordinatesMatches;
void _submitMatches;
void _getHazardsMatches;
void _constraintsMatches;
void _avoidanceMatches;
void _routeMatches;
