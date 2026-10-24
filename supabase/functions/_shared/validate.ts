// Shared request-validation glue (Deno runtime).
//
// Parses an incoming `Request` JSON body and validates it against a zod schema
// from the app-side `@/server/http/dto-schemas` module. On success it yields the
// typed value; on failure it yields a shared `Result.err` with code
// 'validation_error' that the handler passes straight to `toHttpResponse`.
//
// The `@/...` specifiers resolve through the function's `deno.json` import map.

import type { Result } from '@/types';
import { err } from '@/types';
import type { z } from 'zod';

/** Either a parsed value, or a ready-to-return validation error Result. */
export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Result<never> };

/**
 * Read `request` as JSON and validate it with `schema`.
 *
 * A non-JSON body or a schema mismatch both map to a `validation_error`
 * Result (HTTP 400 downstream); the zod issues are carried in `details`.
 */
export async function validateJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<Validated<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    return {
      ok: false,
      error: err({
        code: 'validation_error',
        message: 'Request body was not valid JSON',
        details: String(cause),
      }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: err({
        code: 'validation_error',
        message: 'Request body failed schema validation',
        details: parsed.error.issues,
      }),
    };
  }

  return { ok: true, value: parsed.data };
}
