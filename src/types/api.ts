import type { Coordinates } from './geo';
import type { Hazard } from './hazard';
import type { HazardClassificationResult } from './ai';
import type { RouteRequest, RouteResponse } from './routing';

// Transport-neutral API contract. No HTTP/framework assumptions — identical
// whether served by Supabase Edge Functions or Expo Router API Routes.

/** Closed set of error codes. */
export const APP_ERROR_CODES = [
  'validation_error',
  'not_found',
  'ai_unavailable',
  'db_error',
  'unauthorized',
  'rate_limited',
  'internal_error',
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

/** Discriminated result envelope. */
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

/** Minimal constructors. */
export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });
export const err = <E = AppError>(error: E): Result<never, E> => ({ ok: false, error });

// ---- DTOs ----

export interface SubmitReportRequest {
  readonly imagePath: string;       // Supabase Storage path
  readonly location: Coordinates;
  readonly reporterHints?: string;
}
export interface SubmitReportResponse {
  readonly reportId: string;
  readonly hazard: Hazard;
  readonly classification: HazardClassificationResult;
}

export interface GetHazardsRequest {
  readonly center?: Coordinates;
  readonly radiusMeters?: number;
  readonly buildingId?: string;
}
export interface GetHazardsResponse {
  readonly hazards: readonly Hazard[];
}

export type RequestRouteRequest = RouteRequest;
export type RequestRouteResponse = RouteResponse;
