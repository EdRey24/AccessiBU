// ⚠️ SERVER-ONLY MODULE — imported by Supabase Edge Functions (Deno runtime). ⚠️
//
// This module is runtime-agnostic: it only uses the Web `Response` API (which
// exists in both the Deno Edge runtime AND the jest/jsdom test environment), so
// it is unit-testable from the app side WITHOUT a Deno runtime. The thin Deno
// `index.ts` handlers import `toHttpResponse` to turn a service `Result<T>`
// into an HTTP `Response`, keeping the wire mapping in ONE tested place.
//
// It deals ONLY with the shared `Result<T, AppError>` envelope from `@/types`;
// it has no Supabase/Gemini/DB coupling.

import type { AppErrorCode, Result } from '@/types';

/**
 * Map each closed {@link AppErrorCode} to the HTTP status it should surface.
 *
 * Mirrors the design's Edge Function status mapping:
 *   validation_error -> 400, unauthorized -> 401, not_found -> 404,
 *   rate_limited -> 429, ai_unavailable -> 503, db_error/internal_error -> 500.
 */
const ERROR_STATUS: Readonly<Record<AppErrorCode, number>> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  ai_unavailable: 503,
  db_error: 500,
  internal_error: 500,
};

/** HTTP status for a successful `Result`. */
const OK_STATUS = 200;

/**
 * Resolve the HTTP status for a {@link Result}: 200 on success, otherwise the
 * status mapped from the error's `code` (defaulting to 500 for any unmapped
 * code, which cannot happen while the code union stays closed).
 */
export function statusForResult<T>(result: Result<T>): number {
  if (result.ok) {
    return OK_STATUS;
  }
  return ERROR_STATUS[result.error.code] ?? 500;
}

/** JSON content-type header shared by every response. */
const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
};

/**
 * Serialize a service {@link Result} to a JSON HTTP {@link Response}.
 *
 * The body is ALWAYS the `Result` envelope itself (so the client branches on
 * `ok` exactly as in-process code does); only the HTTP status differs between
 * success and the mapped error codes.
 */
export function toHttpResponse<T>(result: Result<T>): Response {
  return new Response(JSON.stringify(result), {
    status: statusForResult(result),
    headers: JSON_HEADERS,
  });
}
